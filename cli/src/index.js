#!/usr/bin/env node
/**
 * zarklink CLI - Main Entry Point
 * Privacy-preserving Zcash to Starknet bridge CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { relayCommand } from './commands/relay.js';
import { issueCommand } from './commands/issue.js';
import { redeemCommand } from './commands/redeem.js';
import { vaultCommand } from './commands/vault.js';
import { configCommand } from './commands/config.js';
import { statusCommand } from './commands/status.js';
import { testnetCommand } from './commands/testnet.js';
import { LOGO, LOGO_SMALL, bullet, info } from './utils/ui.js';

const program = new Command();

program
  .name('zarklink')
  .description('CLI for zarklink bridge - Privacy-preserving Zcash to Starknet bridge')
  .version('0.1.0');

// Add subcommands
program.addCommand(relayCommand);
program.addCommand(issueCommand);
program.addCommand(redeemCommand);
program.addCommand(vaultCommand);
program.addCommand(configCommand);
program.addCommand(statusCommand);
program.addCommand(testnetCommand);

// Default action
program.action(() => {
  console.log(LOGO);
  console.log(chalk.dim('    Privacy-Preserving Zcash ↔ Starknet Bridge\n'));
  
  console.log(chalk.bold.white('  Commands:\n'));
  console.log(`    ${chalk.cyan('issue')}    ${chalk.dim('─')} Lock ZEC → mint wZEC`);
  console.log(`    ${chalk.cyan('redeem')}   ${chalk.dim('─')} Burn wZEC → unlock ZEC`);
  console.log(`    ${chalk.cyan('relay')}    ${chalk.dim('─')} Manage block header relay`);
  console.log(`    ${chalk.cyan('vault')}    ${chalk.dim('─')} Vault operations`);
  console.log(`    ${chalk.cyan('status')}   ${chalk.dim('─')} Bridge & transaction status`);
  console.log(`    ${chalk.cyan('testnet')}  ${chalk.dim('─')} Zcash testnet utilities`);
  console.log(`    ${chalk.cyan('config')}   ${chalk.dim('─')} Configure settings`);
  console.log('');
  console.log(chalk.dim('  Run `zarklink <command> --help` for more information\n'));
});

program.parse();
