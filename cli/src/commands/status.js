/**
 * Status Command
 * Check bridge and transaction status
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../config.js';
import { getProvider } from '../utils/starknet.js';
import { getBlockchainInfo } from '../utils/zcash.js';
import {
  isBlockConfirmed,
  getRelayChainTip,
} from '../utils/contracts.js';
import { 
  LOGO_SMALL, 
  section, 
  createSpinner, 
  animateLoading,
  success, 
  error, 
  warning, 
  info,
  keyValue,
  table,
  contractAddress,
  txHash,
  progressBar
} from '../utils/ui.js';

export const statusCommand = new Command('status')
  .description('Check bridge and transaction status');

/**
 * Bridge overview
 */
statusCommand
  .command('bridge')
  .alias('overview')
  .description('Get bridge overview status')
  .action(async () => {
    console.log(LOGO_SMALL);
    
    const spinner = createSpinner('Fetching bridge status...').start();
    
    try {
      // Get Zcash info
      let zcashInfo = null;
      try {
        zcashInfo = await getBlockchainInfo();
      } catch (e) {
        // Zcash node may not be running
      }
      
      // Get Starknet info
      let starknetBlock = null;
      try {
        const provider = getProvider();
        starknetBlock = await provider.getBlock('latest');
      } catch (e) {
        // RPC may not be reachable
      }
      
      spinner.stop();
      
      // Zcash Status
      console.log(section('Zcash Network'));
      if (zcashInfo) {
        success(`Connected to ${zcashInfo.chain}`);
        console.log(keyValue({
          'Height': zcashInfo.blocks.toLocaleString(),
          'Sync': progressBar(zcashInfo.verificationprogress * 100, 100, 20),
          'Connections': zcashInfo.connections || 0,
        }));
      } else {
        warning('Node not reachable');
        info(`Configure ZCASH_RPC_URL in .env`);
      }
      
      // Starknet Status
      console.log(section('Starknet Network'));
      if (starknetBlock) {
        success(`Connected to ${config.starknet.network}`);
        console.log(keyValue({
          'Block': starknetBlock.block_number.toLocaleString(),
          'RPC': config.starknet.rpcUrl?.substring(0, 50) + '...' || '(default)',
        }));
      } else {
        warning('RPC not reachable');
        info(`Configure STARKNET_RPC_URL in .env`);
      }
      
      // Contract Status
      console.log(section('Deployed Contracts'));
      console.log(contractAddress('Bridge', config.contracts.bridge));
      console.log(contractAddress('Relay', config.contracts.relay));
      console.log(contractAddress('Token', config.contracts.token));
      console.log(contractAddress('Registry', config.contracts.registry));
      console.log('');
      
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

/**
 * Check transaction status
 */
statusCommand
  .command('tx')
  .description('Check Starknet transaction status')
  .argument('<hash>', 'Transaction hash')
  .action(async (hash) => {
    const spinner = createSpinner('Fetching transaction...').start();
    
    try {
      const provider = getProvider();
      
      let receipt;
      try {
        receipt = await provider.getTransactionReceipt(hash);
      } catch (e) {
        spinner.fail(chalk.yellow('Transaction not found'));
        return;
      }
      
      spinner.stop();
      
      console.log(section('Transaction Status'));
      
      const statusIcon = receipt.status === 'ACCEPTED_ON_L2' || receipt.status === 'ACCEPTED_ON_L1'
        ? chalk.green('✓')
        : receipt.status === 'REJECTED' 
          ? chalk.red('✗')
          : chalk.yellow('⏳');
      
      console.log(keyValue({
        'Hash': hash.substring(0, 20) + '...',
        'Status': `${statusIcon} ${getStatusColor(receipt.status)}`,
        'Block': receipt.block_number?.toLocaleString() || 'Pending',
        'Events': receipt.events?.length || 0,
      }));
      
      if (receipt.events && receipt.events.length > 0) {
        console.log(chalk.dim('\n  Events:'));
        for (const event of receipt.events.slice(0, 5)) {
          console.log(chalk.dim(`    • ${event.keys?.[0]?.substring(0, 20)}...`));
        }
        if (receipt.events.length > 5) {
          console.log(chalk.dim(`    ... and ${receipt.events.length - 5} more`));
        }
      }
      
      console.log('');
      
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

/**
 * Check block status on relay
 */
statusCommand
  .command('block')
  .description('Check if a Zcash block is relayed')
  .argument('<hash>', 'Zcash block hash')
  .action(async (hash) => {
    const spinner = createSpinner('Checking block status...').start();
    
    try {
      // Query relay contract
      let confirmed = null;
      let relayTip = null;
      
      try {
        spinner.text = 'Querying relay contract...';
        confirmed = await isBlockConfirmed(hash);
        relayTip = await getRelayChainTip();
      } catch (contractErr) {
        spinner.stop();
        warning('Could not query relay contract');
        info(`Error: ${contractErr.message}`);
        console.log('');
        
        console.log(section('Block Status'));
        console.log(keyValue({
          'Hash': hash.substring(0, 20) + '...',
          'Status': chalk.yellow('Unable to query'),
          'Note': chalk.gray('Relay contract may not be deployed'),
        }));
        console.log('');
        return;
      }
      
      spinner.stop();
      
      console.log(section('Block Status'));
      console.log(keyValue({
        'Block Hash': hash.substring(0, 20) + '...',
        'Relayed': confirmed ? chalk.green('✓ Yes') : chalk.yellow('✗ No'),
        'Confirmed': confirmed ? chalk.green('✓ Confirmed') : chalk.gray('Not yet'),
      }));
      
      if (relayTip) {
        console.log('');
        console.log(section('Relay Chain Tip'));
        console.log(keyValue({
          'Height': relayTip.height.toString(),
          'Tip Hash': relayTip.tipHash.substring(0, 20) + '...',
        }));
      }
      
      console.log('');
      info('Use `zarklink relay status` for detailed relay information');
      console.log('');
      
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
      process.exit(1);
    }
  });

/**
 * Health check
 */
statusCommand
  .command('health')
  .description('Run health checks on all services')
  .action(async () => {
    console.log(LOGO_SMALL);
    console.log(section('Health Check'));
    
    const checks = [];
    
    // Check Starknet RPC
    process.stdout.write('  Starknet RPC      ');
    try {
      const provider = getProvider();
      await provider.getBlock('latest');
      console.log(chalk.green('✓ Connected'));
      checks.push(['Starknet RPC', true]);
    } catch (e) {
      console.log(chalk.red('✗ Failed'));
      checks.push(['Starknet RPC', false]);
    }
    
    // Check Zcash RPC
    process.stdout.write('  Zcash RPC         ');
    try {
      await getBlockchainInfo();
      console.log(chalk.green('✓ Connected'));
      checks.push(['Zcash RPC', true]);
    } catch (e) {
      console.log(chalk.red('✗ Not available'));
      checks.push(['Zcash RPC', false]);
    }
    
    // Check account configuration
    process.stdout.write('  Account Config    ');
    if (config.starknet.accountAddress && config.starknet.privateKey) {
      console.log(chalk.green('✓ Configured'));
      checks.push(['Account', true]);
    } else {
      console.log(chalk.yellow('⚠ Not configured'));
      checks.push(['Account', false]);
    }
    
    // Check contracts
    process.stdout.write('  Contracts         ');
    const hasContracts = config.contracts.bridge && config.contracts.relay;
    if (hasContracts) {
      console.log(chalk.green('✓ Configured'));
      checks.push(['Contracts', true]);
    } else {
      console.log(chalk.yellow('⚠ Partial'));
      checks.push(['Contracts', false]);
    }
    
    // Summary
    const passed = checks.filter(([_, ok]) => ok).length;
    const total = checks.length;
    
    console.log('');
    if (passed === total) {
      success(`All ${total} checks passed`);
    } else {
      warning(`${passed}/${total} checks passed`);
    }
    console.log('');
  });

/**
 * Get colored status text
 */
function getStatusColor(status) {
  switch (status) {
    case 'ACCEPTED_ON_L2':
    case 'ACCEPTED_ON_L1':
      return chalk.green(status);
    case 'PENDING':
    case 'RECEIVED':
      return chalk.yellow(status);
    case 'REJECTED':
      return chalk.red(status);
    default:
      return status;
  }
}

export default statusCommand;
