/**
 * ZCLAIM Relay Service
 * Continuously relays Zcash block headers to Starknet
 */

import dotenv from 'dotenv';
import pino from 'pino';
import { ZcashClient } from './zcash-client.js';
import { StarknetRelay } from './starknet-relay.js';
import { HeaderProcessor } from './header-processor.js';

dotenv.config();

// Logger
const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

// Configuration
const config = {
  // Zcash
  zcashRpcUrl: process.env.ZCASH_RPC_URL || 'http://127.0.0.1:8232',
  zcashRpcUser: process.env.ZCASH_RPC_USER || '',
  zcashRpcPassword: process.env.ZCASH_RPC_PASSWORD || '',
  
  // Starknet
  starknetRpcUrl: process.env.STARKNET_RPC_URL || 'https://starknet-sepolia.public.blastapi.io',
  starknetAccountAddress: process.env.STARKNET_ACCOUNT_ADDRESS,
  starknetPrivateKey: process.env.STARKNET_PRIVATE_KEY,
  relayContractAddress: process.env.RELAY_CONTRACT_ADDRESS,
  
  // Relay settings
  pollInterval: parseInt(process.env.POLL_INTERVAL || '60000'), // 1 minute
  batchSize: parseInt(process.env.BATCH_SIZE || '10'),
  confirmations: parseInt(process.env.CONFIRMATIONS || '6'),
  startHeight: parseInt(process.env.START_HEIGHT || '0'),
};

class RelayService {
  constructor() {
    this.zcash = new ZcashClient(config);
    this.starknet = new StarknetRelay(config);
    this.processor = new HeaderProcessor();
    this.running = false;
    this.lastRelayedHeight = config.startHeight;
  }
  
  async initialize() {
    logger.info('Initializing relay service...');
    
    // Connect to Zcash node
    await this.zcash.connect();
    const zcashInfo = await this.zcash.getBlockchainInfo();
    logger.info({ chain: zcashInfo.chain, blocks: zcashInfo.blocks }, 'Connected to Zcash');
    
    // Connect to Starknet
    await this.starknet.connect();
    logger.info({ contract: config.relayContractAddress }, 'Connected to Starknet relay');
    
    // Get last relayed height from contract
    try {
      const [tipHash, tipHeight] = await this.starknet.getChainTip();
      this.lastRelayedHeight = tipHeight;
      logger.info({ height: tipHeight }, 'Last relayed block');
    } catch (e) {
      logger.warn('Could not get chain tip from contract, starting from config');
    }
    
    logger.info('Relay service initialized');
  }
  
  async start() {
    this.running = true;
    logger.info({ interval: config.pollInterval }, 'Starting relay loop');
    
    while (this.running) {
      try {
        await this.relayNewBlocks();
      } catch (error) {
        logger.error({ error: error.message }, 'Error in relay loop');
      }
      
      await this.sleep(config.pollInterval);
    }
  }
  
  async relayNewBlocks() {
    // Get current Zcash height
    const info = await this.zcash.getBlockchainInfo();
    const currentHeight = info.blocks;
    
    // Calculate which blocks to relay (with confirmations buffer)
    const targetHeight = currentHeight - config.confirmations;
    
    if (targetHeight <= this.lastRelayedHeight) {
      logger.debug({ current: currentHeight, lastRelayed: this.lastRelayedHeight }, 'No new blocks');
      return;
    }
    
    const startHeight = this.lastRelayedHeight + 1;
    const endHeight = Math.min(startHeight + config.batchSize - 1, targetHeight);
    
    logger.info({ from: startHeight, to: endHeight }, 'Relaying blocks');
    
    for (let height = startHeight; height <= endHeight; height++) {
      try {
        await this.relayBlock(height);
        this.lastRelayedHeight = height;
      } catch (error) {
        logger.error({ height, error: error.message }, 'Failed to relay block');
        break; // Stop on error to maintain chain integrity
      }
    }
  }
  
  async relayBlock(height) {
    // Get block from Zcash
    const blockHash = await this.zcash.getBlockHash(height);
    const rawHeader = await this.zcash.getRawBlockHeader(blockHash);
    
    // Parse header
    const header = this.processor.parseHeader(rawHeader);
    logger.debug({ height, hash: blockHash.substring(0, 16) }, 'Parsed header');
    
    // Encode for Starknet
    const encoded = this.processor.encodeForStarknet(header);
    
    // Submit to Starknet
    const txHash = await this.starknet.submitBlockHeader(encoded, height);
    logger.info({ height, txHash }, 'Block submitted');
    
    // Wait for confirmation
    await this.starknet.waitForTransaction(txHash);
    logger.info({ height }, 'Block confirmed on Starknet');
  }
  
  stop() {
    logger.info('Stopping relay service...');
    this.running = false;
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main
async function main() {
  const service = new RelayService();
  
  // Handle shutdown
  process.on('SIGINT', () => {
    service.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    service.stop();
    process.exit(0);
  });
  
  try {
    await service.initialize();
    await service.start();
  } catch (error) {
    logger.error({ error: error.message }, 'Fatal error');
    process.exit(1);
  }
}

main();
