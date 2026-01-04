/**
 * Testnet Command
 * Zcash testnet setup and utilities
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { config } from '../config.js';
import {
  getBlockchainInfo,
  getChainTip,
  getNetworkParams,
  validateAddress,
  getAddressType,
  getAddressBalance,
  generateTestnetConfig,
  getTestnetFaucetUrl,
  getTestnetExplorerTxUrl,
  getTestnetExplorerBlockUrl,
  getTestnetExplorerAddressUrl,
  getTestnetNodes,
  getBlockFromExplorer,
  getTxFromExplorer,
  isTransactionConfirmed,
  TESTNET,
  MAINNET,
} from '../utils/zcash.js';
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
  formatAddress,
  COLORS
} from '../utils/ui.js';

export const testnetCommand = new Command('testnet')
  .description('Zcash testnet setup and utilities');

/**
 * Setup testnet configuration
 */
testnetCommand
  .command('setup')
  .description('Generate Zcash testnet configuration')
  .option('-o, --output <path>', 'Output path for zcash.conf')
  .option('-u, --rpc-user <user>', 'RPC username', 'zcashrpc')
  .option('-p, --rpc-password <password>', 'RPC password (auto-generated if not provided)')
  .action(async (options) => {
    printHeader('TESTNET SETUP', 'Generate Zcash testnet configuration');
    
    console.log('');
    info('This will generate a zcash.conf file configured for testnet.');
    console.log('');
    
    // Default output path
    const defaultPath = join(homedir(), '.zcash', 'zcash.conf');
    const outputPath = options.output || defaultPath;
    
    // Check if file exists
    if (existsSync(outputPath)) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: chalk.hex(COLORS.warning)(`File ${outputPath} exists. Overwrite?`),
        default: false,
      }]);
      
      if (!overwrite) {
        console.log('');
        warning('Setup cancelled.');
        return;
      }
    }
    
    // Generate config
    const rpcPassword = options.rpcPassword || 'zarklink_' + Math.random().toString(36).substring(2, 15);
    
    const configContent = generateTestnetConfig({
      rpcUser: options.rpcUser,
      rpcPassword: rpcPassword,
      txIndex: true,
      experimentalFeatures: true,
    });
    
    // Ensure directory exists
    const dir = join(outputPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    // Write config
    writeFileSync(outputPath, configContent);
    
    console.log('');
    success(`Testnet configuration written to: ${outputPath}`);
    console.log('');
    
    printBox('Configuration Details', [
      `${chalk.gray('Network:')}     ${chalk.hex(COLORS.highlight)('testnet')}`,
      `${chalk.gray('RPC User:')}    ${chalk.hex(COLORS.highlight)(options.rpcUser)}`,
      `${chalk.gray('RPC Password:')} ${chalk.hex(COLORS.highlight)(rpcPassword)}`,
      `${chalk.gray('RPC Port:')}    ${chalk.hex(COLORS.highlight)('18232')}`,
      `${chalk.gray('P2P Port:')}    ${chalk.hex(COLORS.highlight)('18233')}`,
    ]);
    
    console.log('');
    printSection('Next Steps');
    step(1, 'Download and install zcashd:');
    console.log(`   ${chalk.gray('https://zcash.readthedocs.io/en/latest/rtd_pages/zcashd.html')}`);
    step(2, 'Fetch parameters (first time only):');
    console.log(`   ${chalk.hex(COLORS.primary)('./zcutil/fetch-params.sh')}`);
    step(3, 'Start zcashd:');
    console.log(`   ${chalk.hex(COLORS.primary)('zcashd -daemon')}`);
    step(4, 'Wait for sync (check progress):');
    console.log(`   ${chalk.hex(COLORS.primary)('zcash-cli getblockchaininfo')}`);
    step(5, 'Get testnet coins (TAZ):');
    console.log(`   ${chalk.hex(COLORS.primary)(TESTNET.faucetUrl)}`);
    console.log('');
    
    // Update CLI config
    info('Update zarklink CLI config:');
    console.log(`  ${chalk.hex(COLORS.primary)('zarklink config set zcash.network testnet')}`);
    console.log(`  ${chalk.hex(COLORS.primary)('zarklink config set zcash.rpcUrl http://127.0.0.1:18232')}`);
    console.log(`  ${chalk.hex(COLORS.primary)(`zarklink config set zcash.rpcUser ${options.rpcUser}`)}`);
    console.log(`  ${chalk.hex(COLORS.primary)(`zarklink config set zcash.rpcPassword ${rpcPassword}`)}`);
    console.log('');
  });

/**
 * Check testnet status
 */
testnetCommand
  .command('status')
  .description('Check Zcash testnet connection and status')
  .action(async () => {
    printHeader('TESTNET STATUS', 'Zcash testnet connection');
    
    const spinner = createSpinner('Checking testnet connection...');
    spinner.start();
    
    try {
      const params = getNetworkParams();
      const rpcUrl = config.get ? config.get('zcash.rpcUrl') : config.zcash?.rpcUrl;
      
      spinner.stop();
      
      // Show testnet info
      printBox('Zcash Testnet Info', [
        `${chalk.gray('Network:')}      ${chalk.hex(COLORS.highlight)('testnet')}`,
        `${chalk.gray('Currency:')}     ${chalk.hex(COLORS.highlight)('TAZ (test coins)')}`,
        `${chalk.gray('P2P Port:')}     ${chalk.hex(COLORS.highlight)('18233')}`,
        `${chalk.gray('RPC Port:')}     ${chalk.hex(COLORS.highlight)('18232')}`,
        `${chalk.gray('Address Prefix:')} ${chalk.hex(COLORS.highlight)('tm (transparent), ztestsapling (shielded)')}`,
        '',
        `${chalk.gray('Local RPC:')}    ${rpcUrl ? chalk.hex(COLORS.success)(rpcUrl) : chalk.hex(COLORS.warning)('Not configured')}`,
      ]);
      
      console.log('');
      
      // Try to connect to RPC if configured
      if (rpcUrl) {
        const connectionSpinner = createSpinner('Testing RPC connection...');
        connectionSpinner.start();
        
        try {
          const blockchainInfo = await getBlockchainInfo();
          connectionSpinner.stop();
          
          const isTestnet = blockchainInfo.chain === 'test';
          
          printBox('Node Status', [
            `${chalk.gray('Status:')}     ${isTestnet ? chalk.hex(COLORS.success)('✓ Connected to Testnet') : chalk.hex(COLORS.warning)('⚠ Connected to ' + blockchainInfo.chain)}`,
            `${chalk.gray('Height:')}     ${chalk.hex(COLORS.success)(blockchainInfo.blocks.toLocaleString())}`,
            `${chalk.gray('Tip:')}        ${formatAddress(blockchainInfo.bestblockhash)}`,
            `${chalk.gray('Progress:')}   ${chalk.hex(COLORS.highlight)((blockchainInfo.verificationprogress * 100).toFixed(2) + '%')}`,
          ]);
        } catch (err) {
          connectionSpinner.stop();
          warning(`Cannot connect: ${err.message}`);
          console.log('');
          info('Make sure zcashd is running with testnet config');
        }
      } else {
        info('Testnet operations require a local zcashd node.');
        console.log('');
        info('To set up:');
        console.log(`  ${chalk.hex(COLORS.primary)('zarklink testnet setup')}`);
      }
      
      console.log('');
      
      // Network parameters
      printSection('Network Parameters');
      console.log(`  ${chalk.gray('RPC Port:')}    ${chalk.hex(COLORS.highlight)(params.rpcPort)}`);
      console.log(`  ${chalk.gray('P2P Port:')}    ${chalk.hex(COLORS.highlight)(params.port)}`);
      console.log(`  ${chalk.gray('Currency:')}    ${chalk.hex(COLORS.highlight)(isTestnet ? 'TAZ' : 'ZEC')}`);
      console.log('');
      
      // Activation heights
      printSection('Protocol Activations');
      for (const [name, height] of Object.entries(params.activationHeights)) {
        const activated = blockchainInfo.blocks >= height;
        const icon = activated ? chalk.hex(COLORS.success)('✓') : chalk.gray('○');
        console.log(`  ${icon} ${chalk.gray(name.charAt(0).toUpperCase() + name.slice(1) + ':')} ${chalk.hex(COLORS.highlight)(height.toLocaleString())}`);
      }
      console.log('');
      
      if (!isTestnet) {
        warning('You are connected to mainnet, not testnet!');
        info('To switch to testnet, update your zcash.conf with testnet=1');
        console.log('');
      }
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Get faucet info
 */
testnetCommand
  .command('faucet')
  .description('Get testnet TAZ faucet information')
  .action(async () => {
    printHeader('TESTNET FAUCET', 'Get free TAZ (testnet coins)');
    
    console.log('');
    
    printBox('Testnet Faucet', [
      `${chalk.gray('Currency:')}  ${chalk.hex(COLORS.highlight)('TAZ')} (Testnet ZEC)`,
      `${chalk.gray('Value:')}     ${chalk.gray('No real monetary value')}`,
      `${chalk.gray('Purpose:')}   ${chalk.gray('Testing and development')}`,
      '',
      `${chalk.gray('Faucet URL:')}`,
      `  ${chalk.hex(COLORS.primary)(TESTNET.faucetUrl)}`,
    ]);
    
    console.log('');
    printSection('How to Get TAZ');
    step(1, 'Generate a testnet address:');
    console.log(`   ${chalk.hex(COLORS.primary)('zcash-cli getnewaddress')}`);
    step(2, `Visit the faucet: ${chalk.hex(COLORS.primary)(TESTNET.faucetUrl)}`);
    step(3, 'Enter your testnet address');
    step(4, 'Complete any captcha and submit');
    step(5, 'Wait for confirmation (~2.5 minutes per block)');
    console.log('');
    
    info('Alternative: Join Zcash Discord for TAZ support');
    console.log(`  ${chalk.hex(COLORS.primary)('https://discord.gg/GGtsUzyp')}`);
    console.log('');
  });

/**
 * Explorer lookup
 */
testnetCommand
  .command('explorer')
  .description('Look up transaction or block in testnet explorer')
  .argument('<type>', 'Type: tx, block, or address')
  .argument('<value>', 'Transaction ID, block hash/height, or address')
  .action(async (type, value) => {
    printHeader('TESTNET EXPLORER', `Looking up ${type}`);
    
    const spinner = createSpinner('Fetching data...');
    spinner.start();
    
    try {
      let url;
      let data;
      
      switch (type.toLowerCase()) {
        case 'tx':
        case 'transaction':
          url = getTestnetExplorerTxUrl(value);
          try {
            data = await getTxFromExplorer(value);
            spinner.stop();
            
            printBox('Transaction', [
              `${chalk.gray('TxID:')}           ${formatAddress(value)}`,
              `${chalk.gray('Confirmations:')}  ${chalk.hex(COLORS.highlight)(data.confirmations || 0)}`,
              `${chalk.gray('Block:')}          ${chalk.hex(COLORS.highlight)(data.blockhash ? formatAddress(data.blockhash) : 'Pending')}`,
              `${chalk.gray('Time:')}           ${chalk.white(data.time ? new Date(data.time * 1000).toISOString() : 'N/A')}`,
            ]);
          } catch (err) {
            spinner.stop();
            warning('Could not fetch transaction details');
          }
          break;
          
        case 'block':
          url = getTestnetExplorerBlockUrl(value);
          try {
            data = await getBlockFromExplorer(value);
            spinner.stop();
            
            printBox('Block', [
              `${chalk.gray('Hash:')}           ${formatAddress(data.hash || value)}`,
              `${chalk.gray('Height:')}         ${chalk.hex(COLORS.highlight)(data.height || 'N/A')}`,
              `${chalk.gray('Time:')}           ${chalk.white(data.time ? new Date(data.time * 1000).toISOString() : 'N/A')}`,
              `${chalk.gray('Transactions:')}   ${chalk.hex(COLORS.highlight)(data.tx?.length || data.txCount || 'N/A')}`,
            ]);
          } catch (err) {
            spinner.stop();
            warning('Could not fetch block details');
          }
          break;
          
        case 'addr':
        case 'address':
          url = getTestnetExplorerAddressUrl(value);
          spinner.stop();
          
          // Validate address
          const isValid = validateAddress(value);
          const addrType = getAddressType(value);
          
          printBox('Address', [
            `${chalk.gray('Address:')}  ${formatAddress(value)}`,
            `${chalk.gray('Type:')}     ${chalk.hex(COLORS.highlight)(addrType)}`,
            `${chalk.gray('Valid:')}    ${isValid ? chalk.hex(COLORS.success)('✓ Yes') : chalk.hex(COLORS.error)('✗ No')}`,
          ]);
          break;
          
        default:
          spinner.stop();
          error('Unknown type. Use: tx, block, or address');
          process.exit(1);
      }
      
      console.log('');
      info(`Explorer URL: ${chalk.hex(COLORS.primary)(url)}`);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Validate address
 */
testnetCommand
  .command('validate')
  .description('Validate a Zcash address')
  .argument('<address>', 'Zcash address to validate')
  .action(async (address) => {
    printHeader('ADDRESS VALIDATION', 'Validate Zcash address');
    
    const params = getNetworkParams();
    const isValid = validateAddress(address);
    const addrType = getAddressType(address);
    
    console.log('');
    
    printBox('Validation Result', [
      `${chalk.gray('Address:')}   ${formatAddress(address)}`,
      `${chalk.gray('Type:')}      ${chalk.hex(COLORS.highlight)(addrType)}`,
      `${chalk.gray('Network:')}   ${chalk.hex(COLORS.highlight)(params.network)}`,
      `${chalk.gray('Valid:')}     ${isValid ? chalk.hex(COLORS.success)('✓ Valid for ' + params.network) : chalk.hex(COLORS.error)('✗ Invalid for ' + params.network)}`,
    ]);
    
    console.log('');
    
    if (!isValid) {
      warning('Address is not valid for the configured network.');
      console.log('');
      info('Address prefixes:');
      console.log(`  ${chalk.gray('Testnet transparent:')} tm...`);
      console.log(`  ${chalk.gray('Testnet sapling:')}     ztestsapling...`);
      console.log(`  ${chalk.gray('Testnet unified:')}     utest...`);
      console.log(`  ${chalk.gray('Mainnet transparent:')} t1... or t3...`);
      console.log(`  ${chalk.gray('Mainnet sapling:')}     zs...`);
      console.log(`  ${chalk.gray('Mainnet unified:')}     u1...`);
      console.log('');
    }
  });

/**
 * Check transaction confirmations
 */
testnetCommand
  .command('confirm')
  .description('Check if a transaction has enough confirmations')
  .argument('<txid>', 'Transaction ID')
  .option('-c, --confirmations <n>', 'Required confirmations', '20')
  .action(async (txid, options) => {
    printHeader('CONFIRMATION CHECK', 'Transaction confirmation status');
    
    const spinner = createSpinner('Checking confirmations...');
    spinner.start();
    
    try {
      const minConf = parseInt(options.confirmations);
      const confirmed = await isTransactionConfirmed(txid, minConf);
      
      spinner.stop();
      
      printBox('Confirmation Status', [
        `${chalk.gray('TxID:')}        ${formatAddress(txid)}`,
        `${chalk.gray('Required:')}    ${chalk.hex(COLORS.highlight)(minConf)} confirmations`,
        `${chalk.gray('Confirmed:')}   ${confirmed ? chalk.hex(COLORS.success)('✓ Yes') : chalk.hex(COLORS.warning)('✗ Not yet')}`,
      ]);
      
      console.log('');
      
      if (!confirmed) {
        info(`Waiting for ${minConf} confirmations (~${(minConf * 2.5).toFixed(0)} minutes)`);
        console.log('');
      }
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Info about testnet vs mainnet
 */
testnetCommand
  .command('info')
  .description('Show testnet vs mainnet information')
  .action(async () => {
    printHeader('NETWORK INFO', 'Testnet vs Mainnet comparison');
    
    console.log('');
    
    // Testnet info
    printSection('Testnet');
    console.log(chalk.hex(COLORS.border)('  ┌─────────────────┬──────────────────────────────────┐'));
    console.log(chalk.hex(COLORS.border)('  │') + chalk.hex(COLORS.dim)(' Property        ') + chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.dim)(' Value                            ') + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  ├─────────────────┼──────────────────────────────────┤'));
    console.log(chalk.hex(COLORS.border)('  │') + ' Currency        ' + chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.highlight)(' TAZ (no real value)              ') + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' RPC Port        ' + chalk.hex(COLORS.border)('│') + ' 18232                            ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' P2P Port        ' + chalk.hex(COLORS.border)('│') + ' 18233                            ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' Transparent     ' + chalk.hex(COLORS.border)('│') + ' tm...                            ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' Sapling         ' + chalk.hex(COLORS.border)('│') + ' ztestsapling...                  ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' Explorer        ' + chalk.hex(COLORS.border)('│') + ' explorer.testnet.z.cash          ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' Faucet          ' + chalk.hex(COLORS.border)('│') + ' faucet.zecpages.com              ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  └─────────────────┴──────────────────────────────────┘'));
    console.log('');
    
    // Mainnet info
    printSection('Mainnet');
    console.log(chalk.hex(COLORS.border)('  ┌─────────────────┬──────────────────────────────────┐'));
    console.log(chalk.hex(COLORS.border)('  │') + chalk.hex(COLORS.dim)(' Property        ') + chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.dim)(' Value                            ') + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  ├─────────────────┼──────────────────────────────────┤'));
    console.log(chalk.hex(COLORS.border)('  │') + ' Currency        ' + chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.success)(' ZEC (real value)                 ') + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' RPC Port        ' + chalk.hex(COLORS.border)('│') + ' 8232                             ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' P2P Port        ' + chalk.hex(COLORS.border)('│') + ' 8233                             ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' Transparent     ' + chalk.hex(COLORS.border)('│') + ' t1... or t3...                   ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' Sapling         ' + chalk.hex(COLORS.border)('│') + ' zs...                            ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  │') + ' Explorer        ' + chalk.hex(COLORS.border)('│') + ' explorer.z.cash                  ' + chalk.hex(COLORS.border)('│'));
    console.log(chalk.hex(COLORS.border)('  └─────────────────┴──────────────────────────────────┘'));
    console.log('');
    
    info('Use testnet for development and testing.');
    warning('Never use mainnet for testing - real ZEC has value!');
    console.log('');
  });

export default testnetCommand;
