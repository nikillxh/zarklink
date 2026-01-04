/**
 * Config Command
 * Configure CLI settings
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { config, defaultConfig } from '../config.js';
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
  formatAddress,
  COLORS
} from '../utils/ui.js';

const CONFIG_DIR = join(homedir(), '.zarklink');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export const configCommand = new Command('config')
  .description('Configure CLI settings');

/**
 * Initialize configuration
 */
configCommand
  .command('init')
  .description('Initialize configuration interactively')
  .action(async () => {
    printHeader('CONFIGURATION', 'Setup your zarklink CLI');
    
    console.log('');
    info('Answer the following questions to configure your CLI.');
    console.log('');
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'starknetNetwork',
        message: chalk.hex(COLORS.primary)('Starknet network:'),
        choices: ['sepolia', 'mainnet', 'devnet'],
        default: 'sepolia',
      },
      {
        type: 'input',
        name: 'starknetRpc',
        message: chalk.hex(COLORS.primary)('Starknet RPC URL (enter for default):'),
        default: '',
      },
      {
        type: 'input',
        name: 'accountAddress',
        message: chalk.hex(COLORS.primary)('Starknet account address:'),
        validate: (v) => !v || v.startsWith('0x') ? true : 'Invalid address (must start with 0x)',
      },
      {
        type: 'password',
        name: 'privateKey',
        message: chalk.hex(COLORS.primary)('Starknet private key:'),
      },
      {
        type: 'list',
        name: 'zcashNetwork',
        message: chalk.hex(COLORS.primary)('Zcash network:'),
        choices: ['testnet', 'mainnet'],
        default: 'testnet',
      },
      {
        type: 'input',
        name: 'zcashRpc',
        message: chalk.hex(COLORS.primary)('Zcash RPC URL:'),
        default: 'http://127.0.0.1:8232',
      },
      {
        type: 'input',
        name: 'zcashUser',
        message: chalk.hex(COLORS.dim)('Zcash RPC username (optional):'),
      },
      {
        type: 'password',
        name: 'zcashPassword',
        message: chalk.hex(COLORS.dim)('Zcash RPC password (optional):'),
      },
    ]);
    
    const spinner = createSpinner('Saving configuration...');
    spinner.start();
    
    const newConfig = {
      ...defaultConfig,
      starknet: {
        network: answers.starknetNetwork,
        rpcUrl: answers.starknetRpc || undefined,
        accountAddress: answers.accountAddress,
        privateKey: answers.privateKey,
      },
      zcash: {
        network: answers.zcashNetwork,
        rpcUrl: answers.zcashRpc,
        rpcUser: answers.zcashUser,
        rpcPassword: answers.zcashPassword,
      },
    };
    
    // Save config
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
    
    await new Promise(r => setTimeout(r, 500));
    spinner.stop();
    
    console.log('');
    success('Configuration saved successfully!');
    console.log('');
    
    printBox('Config Location', [
      `${chalk.gray('File:')} ${chalk.hex(COLORS.highlight)('~/.zarklink/config.json')}`,
    ]);
    
    console.log('');
    info(`View settings: ${chalk.hex(COLORS.primary)('zarklink config show')}`);
    console.log('');
  });

/**
 * Show current configuration
 */
configCommand
  .command('show')
  .description('Show current configuration')
  .option('--reveal', 'Show sensitive values')
  .action((options) => {
    printHeader('CURRENT CONFIG', 'Your zarklink settings');
    
    // Starknet Section
    printSection('Starknet');
    printBox('Connection', [
      `${chalk.gray('Network:')}      ${chalk.hex(COLORS.highlight)(config.starknet?.network || 'sepolia')}`,
      `${chalk.gray('RPC URL:')}      ${chalk.white(config.starknet?.rpcUrl || '(default)')}`,
      `${chalk.gray('Account:')}      ${config.starknet?.accountAddress ? formatAddress(config.starknet.accountAddress) : chalk.gray('(not set)')}`,
      `${chalk.gray('Private Key:')}  ${options.reveal && config.starknet?.privateKey ? chalk.hex(COLORS.warning)(config.starknet.privateKey.substring(0, 20) + '...') : chalk.gray('(hidden)')}`,
    ]);
    console.log('');
    
    // Contracts Section
    printSection('Contracts');
    printBox('Deployed Addresses', [
      `${chalk.gray('Bridge:')}    ${config.contracts?.bridge ? formatAddress(config.contracts.bridge) : chalk.gray('(not set)')}`,
      `${chalk.gray('Relay:')}     ${config.contracts?.relay ? formatAddress(config.contracts.relay) : chalk.gray('(not set)')}`,
      `${chalk.gray('Token:')}     ${config.contracts?.token ? formatAddress(config.contracts.token) : chalk.gray('(not set)')}`,
      `${chalk.gray('Registry:')}  ${config.contracts?.registry ? formatAddress(config.contracts.registry) : chalk.gray('(not set)')}`,
    ]);
    console.log('');
    
    // Zcash Section
    printSection('Zcash');
    printBox('RPC Settings', [
      `${chalk.gray('Network:')}   ${chalk.hex(COLORS.highlight)(config.zcash?.network || 'testnet')}`,
      `${chalk.gray('RPC URL:')}   ${chalk.white(config.zcash?.rpcUrl || 'http://127.0.0.1:8232')}`,
      `${chalk.gray('RPC User:')}  ${config.zcash?.rpcUser || chalk.gray('(not set)')}`,
    ]);
    console.log('');
    
    // Bridge Settings Section
    printSection('Bridge Settings');
    printBox('Protocol Parameters', [
      `${chalk.gray('Confirmations:')}  ${chalk.hex(COLORS.highlight)(config.bridge?.minConfirmations || 20)}`,
      `${chalk.gray('Issue Timeout:')}  ${chalk.hex(COLORS.highlight)((config.bridge?.issueTimeout || 86400) + 's')}`,
      `${chalk.gray('Redeem Timeout:')} ${chalk.hex(COLORS.highlight)((config.bridge?.redeemTimeout || 86400) + 's')}`,
      `${chalk.gray('Fee Rate:')}       ${chalk.hex(COLORS.highlight)(((config.bridge?.feeRate || 10) / 100) + '%')}`,
    ]);
    console.log('');
  });

/**
 * Set a configuration value
 */
configCommand
  .command('set')
  .description('Set a configuration value')
  .argument('<key>', 'Configuration key (e.g., starknet.network)')
  .argument('<value>', 'Configuration value')
  .action((key, value) => {
    printHeader('SET CONFIG', `${key}`);
    
    const spinner = createSpinner('Updating configuration...');
    spinner.start();
    
    // Load existing config
    let currentConfig = { ...defaultConfig };
    if (existsSync(CONFIG_PATH)) {
      currentConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    }
    
    // Set the value
    const keys = key.split('.');
    let obj = currentConfig;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    
    // Save
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2));
    
    spinner.stop();
    
    success(`Configuration updated!`);
    console.log('');
    
    printBox('Change Applied', [
      `${chalk.gray('Key:')}   ${chalk.hex(COLORS.highlight)(key)}`,
      `${chalk.gray('Value:')} ${chalk.hex(COLORS.success)(value)}`,
    ]);
    console.log('');
  });

/**
 * Set contract addresses
 */
configCommand
  .command('contracts')
  .description('Set contract addresses')
  .option('--bridge <address>', 'Bridge contract address')
  .option('--relay <address>', 'Relay contract address')
  .option('--token <address>', 'Token contract address')
  .option('--registry <address>', 'Registry contract address')
  .action((options) => {
    printHeader('SET CONTRACTS', 'Update contract addresses');
    
    const spinner = createSpinner('Updating contract addresses...');
    spinner.start();
    
    // Load existing config
    let currentConfig = { ...defaultConfig };
    if (existsSync(CONFIG_PATH)) {
      currentConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    }
    
    if (!currentConfig.contracts) {
      currentConfig.contracts = {};
    }
    
    const updates = [];
    if (options.bridge) {
      currentConfig.contracts.bridge = options.bridge;
      updates.push(`${chalk.gray('Bridge:')}   ${formatAddress(options.bridge)}`);
    }
    if (options.relay) {
      currentConfig.contracts.relay = options.relay;
      updates.push(`${chalk.gray('Relay:')}    ${formatAddress(options.relay)}`);
    }
    if (options.token) {
      currentConfig.contracts.token = options.token;
      updates.push(`${chalk.gray('Token:')}    ${formatAddress(options.token)}`);
    }
    if (options.registry) {
      currentConfig.contracts.registry = options.registry;
      updates.push(`${chalk.gray('Registry:')} ${formatAddress(options.registry)}`);
    }
    
    // Save
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2));
    
    spinner.stop();
    
    if (updates.length > 0) {
      success('Contract addresses updated!');
      console.log('');
      printBox('Updated Contracts', updates);
    } else {
      warning('No contract addresses provided.');
      console.log('');
      info('Usage: zarklink config contracts --bridge <addr> --relay <addr>');
    }
    console.log('');
  });

export default configCommand;
