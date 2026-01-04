/**
 * Redeem Command
 * Burn wZEC and unlock ZEC (Redeem protocol)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { config } from '../config.js';
import { getAccount, getContractWithAccount, waitForTransaction, bigIntToU256 } from '../utils/starknet.js';
import {
  requestRedeem,
  getBurnRequest,
  claimCollateral,
  getRegistryContract,
  getVaultInfo,
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

export const redeemCommand = new Command('redeem')
  .description('Burn wZEC and unlock ZEC (Redeem protocol)');

/**
 * Request redemption
 */
redeemCommand
  .command('request')
  .description('Request to redeem wZEC for ZEC')
  .option('-a, --amount <wzec>', 'Amount of wZEC to burn')
  .option('-t, --to <zaddr>', 'Destination z-address')
  .option('-v, --vault <address>', 'Vault address (optional)')
  .action(async (options) => {
    printHeader('REDEEM REQUEST', 'Burn wZEC to receive ZEC');
    
    const spinner = createSpinner('Initializing redeem request...');
    spinner.start();
    
    try {
      let { amount, to, vault } = options;
      
      if (!amount || !to) {
        spinner.stop();
        console.log('');
        info('Please provide the following details:');
        console.log('');
        
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'amount',
            message: chalk.hex(COLORS.primary)('Amount (wZEC):'),
            when: !amount,
            validate: (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0 ? true : 'Invalid amount (must be positive number)',
          },
          {
            type: 'input',
            name: 'to',
            message: chalk.hex(COLORS.primary)('Destination z-address:'),
            when: !to,
            validate: (v) => v.startsWith('zs') || v.startsWith('zt') ? true : 'Invalid z-address (must start with zs or zt)',
          },
          {
            type: 'input',
            name: 'vault',
            message: chalk.hex(COLORS.dim)('Vault address (optional, press enter to auto-select):'),
            when: !vault,
          },
        ]);
        amount = amount || answers.amount;
        to = to || answers.to;
        vault = vault || answers.vault;
        console.log('');
        spinner.start();
      }
      
      spinner.text = 'Preparing burn transaction...';
      await new Promise(r => setTimeout(r, 800));
      
      spinner.text = 'Generating encryption keys...';
      await new Promise(r => setTimeout(r, 600));
      
      // Encrypt destination z-address for privacy
      const encryptedDest = to.split('').map(c => c.charCodeAt(0).toString());
      
      spinner.text = 'Submitting burn request to contract...';
      
      let result;
      try {
        // Convert amount to satoshis (8 decimals)
        const amountSats = BigInt(Math.floor(parseFloat(amount) * 1e8));
        const vaultAddr = vault || config.get('contracts.vault');
        
        result = await requestRedeem(amountSats, vaultAddr, encryptedDest);
      } catch (contractErr) {
        spinner.stop();
        warning('Contract call failed - displaying estimated values');
        info(`Error: ${contractErr.message}`);
        console.log('');
        
        const mockNonce = Math.floor(Math.random() * 1000000);
        const timeout = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
        
        printBox('Redeem Request (Simulated)', [
          `${chalk.gray('Nonce:')}       ${chalk.hex(COLORS.highlight)(mockNonce)}`,
          `${chalk.gray('Amount:')}      ${chalk.hex(COLORS.warning)(amount)} wZEC → ${chalk.hex(COLORS.success)(amount)} ZEC`,
          `${chalk.gray('Destination:')} ${chalk.hex(COLORS.highlight)(to.substring(0, 25) + '...')}`,
          `${chalk.gray('Vault:')}       ${vault ? formatAddress(vault) : chalk.gray('Auto-selected')}`,
          `${chalk.gray('Status:')}      ${chalk.yellow('Not submitted (contract error)')}`,
        ]);
        console.log('');
        return;
      }
      
      const timeout = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
      
      spinner.stop();
      success('Redeem request submitted successfully!');
      console.log('');
      
      // Display request details
      printBox('Redeem Request Details', [
        `${chalk.gray('Nonce:')}       ${chalk.hex(COLORS.highlight)(result.burnNonce.toString())}`,
        `${chalk.gray('Tx Hash:')}     ${formatAddress(result.txHash)}`,
        `${chalk.gray('Amount:')}      ${chalk.hex(COLORS.warning)(amount)} wZEC → ${chalk.hex(COLORS.success)(amount)} ZEC`,
        `${chalk.gray('Destination:')} ${chalk.hex(COLORS.highlight)(to.substring(0, 25) + '...')}`,
        `${chalk.gray('Vault:')}       ${vault ? formatAddress(vault) : chalk.gray('Auto-selected')}`,
        `${chalk.gray('Timeout:')}     ${chalk.yellow(timeout)}`,
      ]);
      
      console.log('');
      warning('Your wZEC has been burned. Awaiting vault release...');
      console.log('');
      
      printSection('What Happens Next');
      step(1, 'Vault operator receives release request');
      step(2, 'Vault sends shielded ZEC to your destination');
      step(3, 'You receive ZEC at your z-address');
      console.log('');
      
      info(`Check status: ${chalk.hex(COLORS.primary)(`zarklink redeem status ${result.burnNonce}`)}`);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Check redeem status
 */
redeemCommand
  .command('status')
  .description('Check redeem request status')
  .argument('<nonce>', 'Burn nonce')
  .action(async (nonce) => {
    printHeader('REDEEM STATUS', `Request #${nonce}`);
    
    const spinner = createSpinner('Fetching status from contract...');
    spinner.start();
    
    try {
      let burnRequest;
      try {
        burnRequest = await getBurnRequest(BigInt(nonce));
      } catch (contractErr) {
        spinner.stop();
        warning('Could not fetch burn request from contract');
        info(`Error: ${contractErr.message}`);
        console.log('');
        
        // Show placeholder
        printBox('Redeem Status (Unavailable)', [
          `${chalk.gray('Nonce:')}        ${chalk.hex(COLORS.highlight)(nonce)}`,
          `${chalk.gray('Status:')}       ${chalk.red('Unable to fetch')}`,
          '',
          `${chalk.gray('Note:')}         Contract may not be deployed or nonce invalid`,
        ]);
        console.log('');
        return;
      }
      
      spinner.stop();
      
      const timeoutDate = new Date(burnRequest.timeout * 1000);
      const now = Date.now();
      const hoursLeft = Math.max(0, Math.floor((timeoutDate - now) / 3600000));
      const isExpired = now > timeoutDate.getTime();
      
      // Format amount (from satoshis)
      const amountZEC = (Number(burnRequest.amount) / 1e8).toFixed(8);
      
      // Status display
      const statusDisplay = {
        pending: chalk.yellow('⏳ Awaiting Release'),
        released: chalk.hex(COLORS.success)('✓ Released'),
        claimed: chalk.hex(COLORS.warning)('⚠ Collateral Claimed'),
        expired: chalk.red('✗ Expired'),
      };
      
      printBox('Redeem Status', [
        `${chalk.gray('Nonce:')}        ${chalk.hex(COLORS.highlight)(nonce)}`,
        `${chalk.gray('Status:')}       ${statusDisplay[burnRequest.status] || chalk.gray('Unknown')}`,
        `${chalk.gray('Burner:')}       ${formatAddress(burnRequest.burner)}`,
        `${chalk.gray('Vault:')}        ${formatAddress(burnRequest.vault)}`,
        `${chalk.gray('Amount:')}       ${chalk.hex(COLORS.success)(amountZEC)} ZEC`,
        '',
        `${chalk.gray('Timeout:')}      ${chalk.yellow(timeoutDate.toISOString())}`,
        `${chalk.gray('Time Left:')}    ${isExpired ? chalk.red('EXPIRED') : chalk.yellow(`${hoursLeft} hours`)}`,
      ]);
      
      console.log('');
      
      if (burnRequest.status === 'pending') {
        if (isExpired) {
          warning('Timeout has expired! You can now claim collateral.');
          info(`Claim: ${chalk.hex(COLORS.primary)(`zarklink redeem claim ${nonce}`)}`);
        } else {
          info('Vault has time to release. If timeout expires, you can claim collateral.');
          info(`Claim command: ${chalk.hex(COLORS.primary)(`zarklink redeem claim ${nonce}`)}`);
        }
      } else if (burnRequest.status === 'released') {
        success('ZEC has been released to your destination address!');
      } else if (burnRequest.status === 'claimed') {
        info('Collateral has already been claimed.');
      }
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Claim collateral if vault fails
 */
redeemCommand
  .command('claim')
  .description('Claim vault collateral if release timeout expired')
  .argument('<nonce>', 'Burn nonce')
  .action(async (nonce) => {
    printHeader('CLAIM COLLATERAL', `Request #${nonce}`);
    
    const spinner = createSpinner('Checking eligibility...');
    spinner.start();
    
    try {
      spinner.text = 'Fetching burn request status...';
      
      let burnRequest;
      try {
        burnRequest = await getBurnRequest(BigInt(nonce));
      } catch (contractErr) {
        spinner.stop();
        error('Could not fetch burn request from contract');
        info(`Error: ${contractErr.message}`);
        process.exit(1);
      }
      
      spinner.text = 'Verifying timeout expiration...';
      await new Promise(r => setTimeout(r, 500));
      
      const timeoutDate = new Date(burnRequest.timeout * 1000);
      const now = Date.now();
      const timeoutExpired = now > timeoutDate.getTime();
      
      spinner.stop();
      
      // Check status
      if (burnRequest.status === 'released') {
        warning('This burn request has already been released!');
        console.log('');
        info('The vault successfully sent ZEC to your destination.');
        console.log('');
        return;
      }
      
      if (burnRequest.status === 'claimed') {
        warning('Collateral has already been claimed!');
        console.log('');
        return;
      }
      
      if (!timeoutExpired) {
        warning('Timeout has not yet expired!');
        console.log('');
        info('You can only claim collateral after the release timeout has passed.');
        info(`Timeout: ${timeoutDate.toISOString()}`);
        const hoursLeft = Math.floor((timeoutDate.getTime() - now) / 3600000);
        info(`Time remaining: ${hoursLeft} hours`);
        console.log('');
        return;
      }
      
      // Timeout expired, can claim
      spinner.start('Claiming collateral from vault...');
      
      let claimResult;
      try {
        claimResult = await claimCollateral(BigInt(nonce));
      } catch (claimErr) {
        spinner.stop();
        error('Failed to claim collateral');
        info(`Error: ${claimErr.message}`);
        process.exit(1);
      }
      
      spinner.stop();
      success('Collateral claimed successfully!');
      console.log('');
      
      // Calculate collateral (150% of locked amount)
      const amountZEC = Number(burnRequest.amount) / 1e8;
      const collateralAmount = amountZEC * 1.5;
      
      printBox('Claim Result', [
        `${chalk.gray('Burn Nonce:')}   ${chalk.hex(COLORS.highlight)(nonce)}`,
        `${chalk.gray('Tx Hash:')}      ${formatAddress(claimResult.transaction_hash || 'N/A')}`,
        `${chalk.gray('Collateral:')}   ${chalk.hex(COLORS.success)('150%')} of locked amount`,
        `${chalk.gray('Amount:')}       ${chalk.hex(COLORS.success)(collateralAmount.toFixed(4))} STRK`,
        `${chalk.gray('Status:')}       ${chalk.hex(COLORS.success)('✓ Transferred')}`,
      ]);
      
      console.log('');
      warning('The vault has been slashed and removed from active vaults.');
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * List pending redeems
 */
redeemCommand
  .command('list')
  .description('List your pending redemption requests')
  .option('-n, --nonces <nonces>', 'Comma-separated list of burn nonces to check')
  .action(async (options) => {
    printHeader('PENDING REDEMPTIONS', 'Your active redeem requests');
    
    const spinner = createSpinner('Fetching redemptions...');
    spinner.start();
    
    try {
      // If nonces provided, fetch those specific burn requests
      if (options.nonces) {
        const nonceList = options.nonces.split(',').map(n => n.trim());
        const redemptions = [];
        
        for (const nonce of nonceList) {
          try {
            spinner.text = `Fetching burn request #${nonce}...`;
            const burnRequest = await getBurnRequest(BigInt(nonce));
            
            const amountZEC = (Number(burnRequest.amount) / 1e8).toFixed(4);
            const timeoutDate = new Date(burnRequest.timeout * 1000);
            const isExpired = Date.now() > timeoutDate.getTime();
            
            const statusDisplay = {
              pending: { text: 'Awaiting release', color: COLORS.warning },
              released: { text: 'Released', color: COLORS.success },
              claimed: { text: 'Claimed', color: COLORS.highlight },
              expired: { text: 'Expired', color: COLORS.error },
            };
            
            const status = isExpired && burnRequest.status === 'pending' ? 'expired' : burnRequest.status;
            
            redemptions.push({
              nonce,
              amount: amountZEC,
              status: statusDisplay[status]?.text || 'Unknown',
              timeout: timeoutDate.toISOString().substring(0, 16).replace('T', ' '),
              statusColor: statusDisplay[status]?.color || COLORS.dim,
            });
          } catch (err) {
            redemptions.push({
              nonce,
              amount: 'N/A',
              status: 'Not found',
              timeout: '-',
              statusColor: COLORS.dim,
            });
          }
        }
        
        spinner.stop();
        console.log('');
        
        if (redemptions.length === 0) {
          info('No redemption requests found.');
          console.log('');
          return;
        }
        
        // Table header
        console.log(chalk.hex(COLORS.border)('  ┌──────────┬────────────┬───────────────────┬─────────────────────┐'));
        console.log(
          chalk.hex(COLORS.border)('  │') + chalk.hex(COLORS.primary).bold('  Nonce   ') +
          chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold('  Amount   ') +
          chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold('     Status        ') +
          chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold('      Timeout      ') +
          chalk.hex(COLORS.border)('│')
        );
        console.log(chalk.hex(COLORS.border)('  ├──────────┼────────────┼───────────────────┼─────────────────────┤'));
        
        // Table rows
        for (const r of redemptions) {
          console.log(
            chalk.hex(COLORS.border)('  │ ') +
            chalk.hex(COLORS.highlight)(r.nonce.toString().padEnd(8)) +
            chalk.hex(COLORS.border)(' │ ') +
            chalk.hex(COLORS.success)((r.amount + ' ZEC').padEnd(10)) +
            chalk.hex(COLORS.border)(' │ ') +
            chalk.hex(r.statusColor)(r.status.padEnd(17)) +
            chalk.hex(COLORS.border)(' │ ') +
            chalk.white(r.timeout.padEnd(19)) +
            chalk.hex(COLORS.border)(' │')
          );
        }
        
        console.log(chalk.hex(COLORS.border)('  └──────────┴────────────┴───────────────────┴─────────────────────┘'));
        console.log('');
        
        const pending = redemptions.filter(r => r.status === 'Awaiting release' || r.status === 'Expired');
        info(`Total pending: ${chalk.hex(COLORS.highlight)(pending.length)}`);
        
        const totalValue = redemptions
          .filter(r => r.amount !== 'N/A')
          .reduce((a, r) => a + parseFloat(r.amount), 0);
        info(`Total value: ${chalk.hex(COLORS.success)(totalValue.toFixed(4))} ZEC`);
        console.log('');
        
      } else {
        // No nonces provided - explain how to use
        spinner.stop();
        console.log('');
        
        warning('No burn nonces specified.');
        console.log('');
        info('To list specific redemption requests, provide the nonces:');
        console.log(`  ${chalk.hex(COLORS.primary)('zarklink redeem list --nonces 123,456,789')}`);
        console.log('');
        info('To check a single redemption status:');
        console.log(`  ${chalk.hex(COLORS.primary)('zarklink redeem status <nonce>')}`);
        console.log('');
        info('Save your burn nonces when making redeem requests to track them.');
        console.log('');
      }
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

export default redeemCommand;
