/**
 * Relay Command
 * Manage Zcash block header relay to Starknet
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../config.js';
import { getAccount, getContractWithAccount, waitForTransaction, bigIntToU256 } from '../utils/starknet.js';
import { getBlockByHeight, getBlockchainInfo, parseBlockHeader, encodeHeaderForStarknet, getRawBlockHeader } from '../utils/zcash.js';
import {
  getRelayChainTip,
  isBlockConfirmed,
  submitBlockHeader,
} from '../utils/contracts.js';
import {
  printHeader,
  printSection,
  printBox,
  success,
  error,
  warning,
  info,
  step,
  createSpinner,
  typingEffect,
  progressBar,
  formatAddress,
  COLORS
} from '../utils/ui.js';

// Relay contract ABI (simplified)
const RELAY_ABI = [
  {
    name: 'submit_block_header',
    type: 'function',
    inputs: [
      { name: 'header_data', type: 'felt*' },
      { name: 'height', type: 'felt' }
    ],
    outputs: [{ name: 'block_hash', type: 'Uint256' }]
  },
  {
    name: 'get_chain_tip',
    type: 'function',
    inputs: [],
    outputs: [
      { name: 'tip_hash', type: 'Uint256' },
      { name: 'tip_height', type: 'felt' }
    ],
    stateMutability: 'view'
  },
  {
    name: 'is_confirmed',
    type: 'function',
    inputs: [{ name: 'block_hash', type: 'Uint256' }],
    outputs: [{ name: 'confirmed', type: 'felt' }],
    stateMutability: 'view'
  }
];

export const relayCommand = new Command('relay')
  .description('Manage Zcash block header relay');

/**
 * Submit a single block header
 */
relayCommand
  .command('submit')
  .description('Submit a Zcash block header to Starknet')
  .argument('<height>', 'Block height to submit')
  .option('--dry-run', 'Simulate without submitting')
  .action(async (height, options) => {
    printHeader('SUBMIT BLOCK', `Block height ${height}`);
    
    const spinner = createSpinner('Fetching block from Zcash...');
    spinner.start();
    
    try {
      // Get block from Zcash node
      const heightNum = parseInt(height);
      
      spinner.text = 'Retrieving block header...';
      await new Promise(r => setTimeout(r, 800));
      
      const rawHeader = await getRawBlockHeader(await (async () => {
        const info = await getBlockByHeight(heightNum, 1);
        return info.hash;
      })());
      
      const header = parseBlockHeader(rawHeader);
      
      spinner.stop();
      step(1, 'Block header retrieved', true);
      
      if (options.dryRun) {
        console.log('');
        printBox('Block Header Data', [
          `${chalk.gray('Height:')}       ${chalk.hex(COLORS.highlight)(heightNum)}`,
          `${chalk.gray('Prev Hash:')}    ${formatAddress(header.prevBlockHash)}`,
          `${chalk.gray('Merkle Root:')}  ${formatAddress(header.merkleRoot || '0x...')}`,
          `${chalk.gray('Timestamp:')}    ${chalk.white(header.time || 'N/A')}`,
        ]);
        console.log('');
        warning('Dry run complete - no transaction submitted.');
        return;
      }
      
      // Encode for Starknet
      spinner.start('Encoding header for Starknet...');
      const encoded = encodeHeaderForStarknet(header);
      await new Promise(r => setTimeout(r, 500));
      
      spinner.stop();
      step(2, 'Header encoded for Starknet', true);
      
      spinner.start('Submitting to RelaySystem contract...');
      
      // Get contract
      const contract = await getContractWithAccount(config.contracts.relay, RELAY_ABI);
      
      // Submit
      const tx = await contract.submit_block_header(encoded, heightNum);
      
      spinner.text = `Waiting for confirmation...`;
      
      await waitForTransaction(tx.transaction_hash, (status) => {
        spinner.text = `Transaction status: ${chalk.gray(status)}`;
      });
      
      spinner.stop();
      step(3, 'Transaction confirmed', true);
      console.log('');
      
      success(`Block ${heightNum} submitted successfully!`);
      console.log('');
      
      printBox('Submission Result', [
        `${chalk.gray('Block:')}    ${chalk.hex(COLORS.highlight)(heightNum)}`,
        `${chalk.gray('Tx Hash:')} ${formatAddress(tx.transaction_hash)}`,
      ]);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Sync multiple blocks
 */
relayCommand
  .command('sync')
  .description('Sync block headers from Zcash to Starknet')
  .option('-s, --start <height>', 'Starting block height')
  .option('-e, --end <height>', 'Ending block height (default: current tip)')
  .option('-b, --batch <size>', 'Batch size', '10')
  .action(async (options) => {
    printHeader('BLOCK SYNC', 'Synchronize Zcash headers to Starknet');
    
    const spinner = createSpinner('Checking chain state...');
    spinner.start();
    
    try {
      // Get Zcash chain tip
      const zcashInfo = await getBlockchainInfo();
      const zcashTip = zcashInfo.blocks;
      
      // Determine start and end
      const startHeight = options.start ? parseInt(options.start) : 1;
      const endHeight = options.end ? parseInt(options.end) : zcashTip;
      const batchSize = parseInt(options.batch);
      const totalBlocks = endHeight - startHeight + 1;
      
      spinner.stop();
      
      printBox('Sync Configuration', [
        `${chalk.gray('Start Block:')}  ${chalk.hex(COLORS.highlight)(startHeight)}`,
        `${chalk.gray('End Block:')}    ${chalk.hex(COLORS.highlight)(endHeight)}`,
        `${chalk.gray('Total Blocks:')} ${chalk.hex(COLORS.highlight)(totalBlocks)}`,
        `${chalk.gray('Batch Size:')}   ${chalk.hex(COLORS.highlight)(batchSize)}`,
        `${chalk.gray('Zcash Tip:')}    ${chalk.hex(COLORS.success)(zcashTip)}`,
      ]);
      console.log('');
      
      info(`Starting sync of ${totalBlocks} blocks...`);
      console.log('');
      
      let current = startHeight;
      let synced = 0;
      let failed = 0;
      
      while (current <= endHeight) {
        const batchEnd = Math.min(current + batchSize - 1, endHeight);
        
        printSection(`Batch ${Math.floor((current - startHeight) / batchSize) + 1}`);
        
        // Process batch
        for (let h = current; h <= batchEnd; h++) {
          const progress = Math.floor(((h - startHeight) / totalBlocks) * 100);
          
          try {
            const block = await getBlockByHeight(h, 1);
            const rawHeader = await getRawBlockHeader(block.hash);
            const header = parseBlockHeader(rawHeader);
            const encoded = encodeHeaderForStarknet(header);
            
            const contract = await getContractWithAccount(config.contracts.relay, RELAY_ABI);
            const tx = await contract.submit_block_header(encoded, h);
            
            await waitForTransaction(tx.transaction_hash);
            
            synced++;
            console.log(`  ${chalk.hex(COLORS.success)('✓')} Block ${chalk.hex(COLORS.highlight)(h)} ${chalk.gray(`(${progress}%)`)}`);
          } catch (err) {
            failed++;
            console.log(`  ${chalk.hex(COLORS.warning)('⚠')} Block ${chalk.hex(COLORS.highlight)(h)}: ${chalk.gray(err.message.substring(0, 40))}`);
          }
        }
        
        console.log('');
        current = batchEnd + 1;
      }
      
      success('Sync complete!');
      console.log('');
      
      printBox('Sync Results', [
        `${chalk.gray('Synced:')}  ${chalk.hex(COLORS.success)(synced)} blocks`,
        `${chalk.gray('Failed:')}  ${failed > 0 ? chalk.hex(COLORS.error)(failed) : chalk.gray('0')} blocks`,
        `${chalk.gray('Total:')}   ${chalk.hex(COLORS.highlight)(totalBlocks)} blocks`,
      ]);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Sync failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Get relay status
 */
relayCommand
  .command('status')
  .description('Get relay chain status')
  .action(async () => {
    printHeader('RELAY STATUS', 'Zcash ↔ Starknet relay status');
    
    const spinner = createSpinner('Fetching relay status...');
    spinner.start();
    
    try {
      // Get Zcash info
      let zcashInfo = null;
      try {
        spinner.text = 'Connecting to Zcash node...';
        zcashInfo = await getBlockchainInfo();
      } catch (e) {
        // Zcash node may not be available
      }
      
      // Get Starknet relay status
      let relayTip = null;
      try {
        spinner.text = 'Fetching relay chain tip from Starknet...';
        relayTip = await getRelayChainTip();
      } catch (e) {
        // Relay contract may not be deployed
      }
      
      spinner.stop();
      
      // Zcash Chain Status
      printSection('Zcash Chain');
      if (zcashInfo) {
        printBox('Chain Info', [
          `${chalk.gray('Network:')}  ${chalk.hex(COLORS.highlight)(zcashInfo.chain)}`,
          `${chalk.gray('Height:')}   ${chalk.hex(COLORS.success)(zcashInfo.blocks)}`,
          `${chalk.gray('Tip:')}      ${formatAddress(zcashInfo.bestblockhash)}`,
          `${chalk.gray('Status:')}   ${chalk.hex(COLORS.success)('✓ Connected')}`,
        ]);
      } else {
        printBox('Chain Info', [
          `${chalk.gray('Status:')}   ${chalk.hex(COLORS.error)('✗ Not Connected')}`,
          `${chalk.gray('Note:')}     ${chalk.gray('Check ZCASH_RPC_* env variables')}`,
        ]);
      }
      console.log('');
      
      // Starknet Relay Status
      printSection('Starknet Relay');
      if (relayTip) {
        printBox('Relay Contract', [
          `${chalk.gray('Address:')}    ${formatAddress(config.get('contracts.relay') || 'Not configured')}`,
          `${chalk.gray('Network:')}    ${chalk.hex(COLORS.highlight)(config.get('network') || 'unknown')}`,
          `${chalk.gray('Tip Height:')} ${chalk.hex(COLORS.success)(relayTip.height)}`,
          `${chalk.gray('Tip Hash:')}   ${formatAddress(relayTip.tipHash)}`,
          `${chalk.gray('Status:')}     ${chalk.hex(COLORS.success)('✓ Connected')}`,
        ]);
      } else if (config.get('contracts.relay')) {
        printBox('Relay Contract', [
          `${chalk.gray('Address:')}    ${formatAddress(config.get('contracts.relay'))}`,
          `${chalk.gray('Status:')}     ${chalk.hex(COLORS.warning)('Unable to fetch chain tip')}`,
          `${chalk.gray('Note:')}       ${chalk.gray('Contract may not be deployed correctly')}`,
        ]);
      } else {
        printBox('Relay Contract', [
          `${chalk.gray('Status:')}  ${chalk.hex(COLORS.warning)('Not configured')}`,
          `${chalk.gray('Note:')}    ${chalk.gray('Set contracts.relay in config')}`,
        ]);
      }
      console.log('');
      
      // Sync Status
      if (zcashInfo && relayTip) {
        printSection('Sync Status');
        const relayHeight = Number(relayTip.height);
        const zcashHeight = zcashInfo.blocks;
        const syncPercent = Math.min(100, Math.floor((relayHeight / zcashHeight) * 100));
        
        console.log(`  ${progressBar(syncPercent)} ${relayHeight}/${zcashHeight}`);
        console.log('');
        
        const blocksBehind = zcashHeight - relayHeight;
        if (blocksBehind > 0) {
          warning(`Relay is ${blocksBehind} blocks behind.`);
          info(`Run: ${chalk.hex(COLORS.primary)('zarklink relay sync --start ' + (relayHeight + 1))}`);
        } else {
          success('Relay is fully synced!');
        }
        console.log('');
      } else if (zcashInfo && !relayTip) {
        printSection('Sync Status');
        warning('Cannot determine sync status - relay contract not accessible.');
        console.log('');
      }
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

export default relayCommand;
