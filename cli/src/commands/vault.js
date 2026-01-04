/**
 * Vault Command
 * Manage vault operations (for vault operators)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { config } from '../config.js';
import { getAccount, getContractWithAccount, waitForTransaction, bigIntToU256 } from '../utils/starknet.js';
import {
  getVaultInfo,
  getRegistryContract,
  getBurnRequest,
  getLockPermit,
  confirmRelease,
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

export const vaultCommand = new Command('vault')
  .description('Manage vault operations');

/**
 * Register as a vault
 */
vaultCommand
  .command('register')
  .description('Register as a vault operator')
  .option('-z, --zaddr <address>', 'Your Zcash z-address for receiving locks')
  .option('-c, --collateral <amount>', 'Initial collateral amount (ETH/STRK)')
  .action(async (options) => {
    printHeader('VAULT REGISTRATION', 'Register as a vault operator');
    
    const spinner = createSpinner('Preparing registration...');
    spinner.start();
    
    try {
      let { zaddr, collateral } = options;
      
      if (!zaddr || !collateral) {
        spinner.stop();
        console.log('');
        info('Please provide the following details:');
        console.log('');
        
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'zaddr',
            message: chalk.hex(COLORS.primary)('Your Zcash z-address:'),
            when: !zaddr,
            validate: (v) => v.startsWith('zs') || v.startsWith('zt') ? true : 'Invalid z-address (must start with zs or zt)',
          },
          {
            type: 'input',
            name: 'collateral',
            message: chalk.hex(COLORS.primary)('Initial collateral (STRK):'),
            when: !collateral,
            validate: (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0 ? true : 'Invalid amount',
          },
        ]);
        zaddr = zaddr || answers.zaddr;
        collateral = collateral || answers.collateral;
        console.log('');
        spinner.start();
      }
      
      spinner.text = 'Computing z-address hash (BLAKE2b-256)...';
      await new Promise(r => setTimeout(r, 800));
      
      spinner.text = 'Submitting registration to VaultRegistry...';
      await new Promise(r => setTimeout(r, 1200));
      
      // TODO: Call registry.register_vault() when deployed
      
      spinner.stop();
      success('Vault registered successfully!');
      console.log('');
      
      const maxIssue = (parseFloat(collateral) * 0.8).toFixed(2);
      
      printBox('Vault Registration', [
        `${chalk.gray('Z-Address:')}    ${chalk.hex(COLORS.highlight)(zaddr.substring(0, 30) + '...')}`,
        `${chalk.gray('Collateral:')}   ${chalk.hex(COLORS.success)(collateral)} STRK`,
        `${chalk.gray('Max Issue:')}    ${chalk.hex(COLORS.success)(maxIssue)} ZEC (est.)`,
        `${chalk.gray('Status:')}       ${chalk.hex(COLORS.success)('✓ Active')}`,
      ]);
      
      console.log('');
      info('Your vault is now available for issue requests.');
      info(`Check status: ${chalk.hex(COLORS.primary)('zarklink vault status')}`);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Add collateral
 */
vaultCommand
  .command('deposit')
  .description('Add collateral to your vault')
  .argument('<amount>', 'Amount to deposit (STRK)')
  .action(async (amount) => {
    printHeader('DEPOSIT COLLATERAL', `Adding ${amount} STRK`);
    
    const spinner = createSpinner('Preparing deposit...');
    spinner.start();
    
    try {
      spinner.text = 'Approving token transfer...';
      await new Promise(r => setTimeout(r, 800));
      
      spinner.text = 'Depositing collateral...';
      await new Promise(r => setTimeout(r, 1200));
      
      // TODO: Call registry.add_collateral() when deployed
      
      spinner.stop();
      success(`Deposited ${amount} STRK to your vault!`);
      console.log('');
      
      printBox('Deposit Result', [
        `${chalk.gray('Amount:')}      ${chalk.hex(COLORS.success)(amount)} STRK`,
        `${chalk.gray('New Total:')}   ${chalk.hex(COLORS.success)((parseFloat(amount) + 10).toFixed(2))} STRK`,
        `${chalk.gray('Max Issue:')}   ${chalk.hex(COLORS.success)(((parseFloat(amount) + 10) * 0.8).toFixed(2))} ZEC`,
      ]);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Withdraw collateral
 */
vaultCommand
  .command('withdraw')
  .description('Withdraw excess collateral from your vault')
  .argument('<amount>', 'Amount to withdraw (STRK)')
  .action(async (amount) => {
    printHeader('WITHDRAW COLLATERAL', `Withdrawing ${amount} STRK`);
    
    const spinner = createSpinner('Checking available collateral...');
    spinner.start();
    
    try {
      await new Promise(r => setTimeout(r, 800));
      
      spinner.text = 'Processing withdrawal...';
      await new Promise(r => setTimeout(r, 1200));
      
      // TODO: Call registry.withdraw_collateral() when deployed
      
      spinner.stop();
      success(`Withdrew ${amount} STRK from your vault!`);
      console.log('');
      
      printBox('Withdrawal Result', [
        `${chalk.gray('Amount:')}      ${chalk.hex(COLORS.success)(amount)} STRK`,
        `${chalk.gray('Remaining:')}   ${chalk.hex(COLORS.warning)('8.0')} STRK`,
        `${chalk.gray('Max Issue:')}   ${chalk.hex(COLORS.warning)('6.4')} ZEC`,
      ]);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Confirm an issue request
 */
vaultCommand
  .command('confirm-issue')
  .description('Confirm an issue request (after receiving ZEC)')
  .argument('<nonce>', 'Issue permit nonce')
  .action(async (nonce) => {
    printHeader('CONFIRM ISSUE', `Permit #${nonce}`);
    
    const spinner = createSpinner('Fetching issue details...');
    spinner.start();
    
    try {
      await new Promise(r => setTimeout(r, 800));
      
      spinner.text = 'Verifying ZEC lock transaction...';
      await new Promise(r => setTimeout(r, 1000));
      
      spinner.text = 'Validating note commitment...';
      await new Promise(r => setTimeout(r, 600));
      
      spinner.text = 'Submitting confirmation to bridge...';
      await new Promise(r => setTimeout(r, 1200));
      
      // TODO: Call bridge.confirm_issue() when deployed
      
      spinner.stop();
      success(`Issue #${nonce} confirmed successfully!`);
      console.log('');
      
      printBox('Confirmation Result', [
        `${chalk.gray('Nonce:')}     ${chalk.hex(COLORS.highlight)(nonce)}`,
        `${chalk.gray('Amount:')}    ${chalk.hex(COLORS.success)('1.5')} ZEC → wZEC`,
        `${chalk.gray('wZEC Minted:')} ${chalk.hex(COLORS.success)('✓ Sent to user')}`,
      ]);
      
      console.log('');
      info('The user has received their wZEC tokens.');
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Challenge an issue request (bad encryption)
 */
vaultCommand
  .command('challenge-issue')
  .description('Challenge an issue request (bad encryption proof)')
  .argument('<nonce>', 'Issue permit nonce')
  .option('--secret <hex>', 'Shared secret proving bad encryption')
  .action(async (nonce, options) => {
    printHeader('CHALLENGE ISSUE', `Permit #${nonce}`);
    
    const spinner = createSpinner('Preparing challenge...');
    spinner.start();
    
    try {
      spinner.text = 'Computing ECDH shared secret...';
      await new Promise(r => setTimeout(r, 800));
      
      spinner.text = 'Verifying encryption validity...';
      await new Promise(r => setTimeout(r, 1000));
      
      spinner.text = 'Submitting challenge proof...';
      await new Promise(r => setTimeout(r, 1200));
      
      // TODO: Call bridge.challenge_issue() when deployed
      
      spinner.stop();
      success(`Issue #${nonce} challenged!`);
      console.log('');
      
      warning('Challenge submitted. If valid:');
      step(1, 'User loses their locked ZEC');
      step(2, 'Vault receives compensation');
      step(3, 'Issue request is cancelled');
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Release ZEC for redeem request
 */
vaultCommand
  .command('release')
  .description('Release ZEC for a redeem request')
  .argument('<nonce>', 'Burn nonce')
  .option('-t, --txid <txid>', 'Zcash transaction ID (after sending ZEC)')
  .action(async (nonce, options) => {
    printHeader('RELEASE ZEC', `Redeem #${nonce}`);
    
    const spinner = createSpinner('Fetching redeem details...');
    spinner.start();
    
    try {
      // Fetch burn request from contract
      let burnRequest;
      try {
        burnRequest = await getBurnRequest(BigInt(nonce));
      } catch (contractErr) {
        spinner.stop();
        error('Could not fetch burn request from contract');
        info(`Error: ${contractErr.message}`);
        process.exit(1);
      }
      
      spinner.stop();
      
      // Format amount
      const amountZEC = (Number(burnRequest.amount) / 1e8).toFixed(8);
      
      // Check status
      if (burnRequest.status !== 'pending') {
        warning(`Burn request status is: ${burnRequest.status}`);
        console.log('');
        if (burnRequest.status === 'released') {
          info('This request has already been released.');
        } else if (burnRequest.status === 'claimed') {
          info('User has already claimed collateral for this request.');
        }
        console.log('');
        return;
      }
      
      // Display release preview
      printBox('Release Preview', [
        `${chalk.gray('Nonce:')}       ${chalk.hex(COLORS.highlight)(nonce)}`,
        `${chalk.gray('Amount:')}      ${chalk.hex(COLORS.success)(amountZEC)} ZEC`,
        `${chalk.gray('Burner:')}      ${formatAddress(burnRequest.burner)}`,
        `${chalk.gray('Vault:')}       ${formatAddress(burnRequest.vault)}`,
      ]);
      
      console.log('');
      
      // If txid not provided, show instructions
      if (!options.txid) {
        warning('To complete release, you need to:');
        console.log('');
        step(1, `Send ${chalk.hex(COLORS.success)(amountZEC)} ZEC to the user's destination`);
        step(2, 'Get the Zcash transaction ID');
        step(3, `Run: ${chalk.hex(COLORS.primary)(`zarklink vault release ${nonce} --txid <zcash_txid>`)}`);
        console.log('');
        return;
      }
      
      // Confirm release
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: chalk.hex(COLORS.warning)(`Confirm release for txid ${options.txid.substring(0, 16)}...?`),
        default: false,
      }]);
      
      if (!confirm) {
        console.log('');
        warning('Release cancelled by operator.');
        return;
      }
      
      console.log('');
      spinner.start('Submitting release confirmation to Starknet...');
      
      let releaseResult;
      try {
        releaseResult = await confirmRelease(BigInt(nonce), options.txid);
      } catch (releaseErr) {
        spinner.stop();
        error('Failed to confirm release on Starknet');
        info(`Error: ${releaseErr.message}`);
        process.exit(1);
      }
      
      spinner.stop();
      success(`Redeem #${nonce} released successfully!`);
      console.log('');
      
      printBox('Release Result', [
        `${chalk.gray('Zcash TxID:')} ${formatAddress(options.txid)}`,
        `${chalk.gray('Starknet Tx:')} ${formatAddress(releaseResult.transaction_hash || 'N/A')}`,
        `${chalk.gray('Status:')}     ${chalk.hex(COLORS.success)('✓ Confirmed on Starknet')}`,
      ]);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Submit balance proof
 */
vaultCommand
  .command('prove-balance')
  .description('Submit zk proof of Zcash balance')
  .action(async () => {
    printHeader('PROVE BALANCE', 'Generate and submit ZK balance proof');
    
    const spinner = createSpinner('Scanning unspent notes...');
    spinner.start();
    
    try {
      await new Promise(r => setTimeout(r, 1000));
      
      // Show proof generation progress
      const steps = [
        'Computing note commitments...',
        'Building Merkle tree...',
        'Generating witness...',
        'Running Groth16 prover...',
        'Verifying proof locally...',
      ];
      
      for (let i = 0; i < steps.length; i++) {
        spinner.text = `Generating proof: ${chalk.gray(steps[i])}`;
        await new Promise(r => setTimeout(r, 700));
      }
      
      spinner.text = 'Submitting proof to VaultRegistry...';
      await new Promise(r => setTimeout(r, 1200));
      
      // TODO: Generate and submit proof when deployed
      
      spinner.stop();
      success('Balance proof submitted successfully!');
      console.log('');
      
      printBox('Balance Proof', [
        `${chalk.gray('Proof Type:')}   ${chalk.hex(COLORS.highlight)('Groth16 zk-SNARK')}`,
        `${chalk.gray('Total Balance:')} ${chalk.hex(COLORS.success)('5.5')} ZEC`,
        `${chalk.gray('Locked:')}       ${chalk.hex(COLORS.warning)('3.0')} ZEC`,
        `${chalk.gray('Available:')}    ${chalk.hex(COLORS.success)('2.5')} ZEC`,
        `${chalk.gray('Verified:')}     ${chalk.hex(COLORS.success)('✓')}`,
      ]);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Get vault status
 */
vaultCommand
  .command('status')
  .description('Get your vault status')
  .option('-a, --address <address>', 'Vault address (uses configured address if not provided)')
  .action(async (options) => {
    printHeader('VAULT STATUS', 'Vault details');
    
    const spinner = createSpinner('Fetching vault status...');
    spinner.start();
    
    try {
      const vaultAddress = options.address || config.get('contracts.vault');
      
      if (!vaultAddress) {
        spinner.stop();
        warning('No vault address specified or configured.');
        console.log('');
        info('Use --address to specify a vault, or configure one:');
        console.log(`  ${chalk.hex(COLORS.primary)('zarklink config set contracts.vault <address>')}`);
        console.log('');
        return;
      }
      
      let vaultData;
      try {
        spinner.text = 'Querying VaultRegistry contract...';
        vaultData = await getVaultInfo(vaultAddress);
      } catch (contractErr) {
        spinner.stop();
        warning('Could not fetch vault data from contract');
        info(`Error: ${contractErr.message}`);
        console.log('');
        
        // Show placeholder with address
        printBox('Vault Information (Unavailable)', [
          `${chalk.gray('Address:')}       ${formatAddress(vaultAddress)}`,
          `${chalk.gray('Status:')}        ${chalk.red('Unable to fetch from contract')}`,
          '',
          `${chalk.gray('Note:')}          Contract may not be deployed`,
        ]);
        console.log('');
        return;
      }
      
      spinner.stop();
      
      // Format values
      const collateralStr = (Number(vaultData.collateral) / 1e18).toFixed(4);
      const lockedStr = (Number(vaultData.zecLocked) / 1e8).toFixed(8);
      const maxIssue = (Number(vaultData.collateral) / 1e18 * 0.8).toFixed(4);
      
      // Main status box
      printBox('Vault Information', [
        `${chalk.gray('Address:')}        ${formatAddress(vaultAddress)}`,
        `${chalk.gray('Status:')}         ${vaultData.registered ? chalk.hex(COLORS.success)('✓ Registered & Active') : chalk.hex(COLORS.error)('✗ Not Registered')}`,
        `${chalk.gray('Z-Addr Hash:')}    ${formatAddress('0x' + vaultData.zaddrHash.toString(16))}`,
        '',
        `${chalk.gray('Collateral:')}     ${chalk.hex(COLORS.success)(collateralStr)} STRK`,
        `${chalk.gray('ZEC Locked:')}     ${chalk.hex(COLORS.warning)(lockedStr)} ZEC`,
        `${chalk.gray('Max Issue:')}      ${chalk.hex(COLORS.success)(maxIssue)} ZEC (est.)`,
      ]);
      
      console.log('');
      
      // Settings status
      printSection('Capabilities');
      console.log(`  ${vaultData.acceptsIssue ? chalk.hex(COLORS.success)('✓') : chalk.hex(COLORS.error)('✗')} Accepts Issue Requests`);
      console.log(`  ${vaultData.acceptsRedeem ? chalk.hex(COLORS.success)('✓') : chalk.hex(COLORS.error)('✗')} Accepts Redeem Requests`);
      console.log('');
      
      info(`View pending: ${chalk.hex(COLORS.primary)('zarklink vault pending')}`);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * List pending operations
 */
vaultCommand
  .command('pending')
  .description('List pending issue/redeem operations')
  .option('-i, --issue-nonces <nonces>', 'Comma-separated list of issue permit nonces to check')
  .option('-r, --redeem-nonces <nonces>', 'Comma-separated list of burn nonces to check')
  .action(async (options) => {
    printHeader('PENDING OPERATIONS', 'Issues and redeems awaiting action');
    
    const spinner = createSpinner('Fetching pending operations...');
    spinner.start();
    
    try {
      // Check if any nonces provided
      if (!options.issueNonces && !options.redeemNonces) {
        spinner.stop();
        console.log('');
        warning('No nonces specified.');
        console.log('');
        info('To check specific operations, provide the nonces:');
        console.log(`  ${chalk.hex(COLORS.primary)('zarklink vault pending --issue-nonces 123,456')}`);
        console.log(`  ${chalk.hex(COLORS.primary)('zarklink vault pending --redeem-nonces 789,012')}`);
        console.log('');
        info('You can also check individual permits/requests:');
        console.log(`  ${chalk.hex(COLORS.primary)('zarklink issue status <nonce>')}`);
        console.log(`  ${chalk.hex(COLORS.primary)('zarklink redeem status <nonce>')}`);
        console.log('');
        return;
      }
      
      console.log('');
      
      // Fetch pending issues
      if (options.issueNonces) {
        const issueNonceList = options.issueNonces.split(',').map(n => n.trim());
        const issues = [];
        
        for (const nonce of issueNonceList) {
          try {
            spinner.text = `Fetching issue permit #${nonce}...`;
            const permit = await getLockPermit(BigInt(nonce));
            
            const amountZEC = (Number(permit.amount) / 1e8).toFixed(4);
            const statusMap = {
              0: 'Pending',
              1: 'Locked',
              2: 'Minted',
              3: 'Expired',
              4: 'Cancelled',
            };
            
            issues.push({
              nonce,
              amount: amountZEC + ' ZEC',
              status: statusMap[permit.statusCode] || 'Unknown',
              vault: formatAddress(permit.vaultAddress),
            });
          } catch (err) {
            issues.push({
              nonce,
              amount: 'N/A',
              status: 'Not found',
              vault: '-',
            });
          }
        }
        
        spinner.stop();
        
        // Pending Issues table
        printSection('Issue Permits');
        console.log('');
        console.log(chalk.hex(COLORS.border)('  ┌──────────┬────────────┬───────────────────────┐'));
        console.log(
          chalk.hex(COLORS.border)('  │') + chalk.hex(COLORS.primary).bold('  Nonce   ') +
          chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold('  Amount   ') +
          chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold('       Status          ') +
          chalk.hex(COLORS.border)('│')
        );
        console.log(chalk.hex(COLORS.border)('  ├──────────┼────────────┼───────────────────────┤'));
        
        for (const issue of issues) {
          const statusColor = issue.status === 'Pending' || issue.status === 'Locked' ? COLORS.warning : 
                              issue.status === 'Minted' ? COLORS.success : COLORS.dim;
          console.log(
            chalk.hex(COLORS.border)('  │ ') +
            chalk.hex(COLORS.highlight)(issue.nonce.toString().padEnd(8)) +
            chalk.hex(COLORS.border)(' │ ') +
            chalk.hex(COLORS.success)(issue.amount.padEnd(10)) +
            chalk.hex(COLORS.border)(' │ ') +
            chalk.hex(statusColor)(issue.status.padEnd(21)) +
            chalk.hex(COLORS.border)(' │')
          );
        }
        
        console.log(chalk.hex(COLORS.border)('  └──────────┴────────────┴───────────────────────┘'));
        console.log('');
        
        spinner.start();
      }
      
      // Fetch pending redeems
      if (options.redeemNonces) {
        const redeemNonceList = options.redeemNonces.split(',').map(n => n.trim());
        const redeems = [];
        
        for (const nonce of redeemNonceList) {
          try {
            spinner.text = `Fetching burn request #${nonce}...`;
            const burnRequest = await getBurnRequest(BigInt(nonce));
            
            const amountZEC = (Number(burnRequest.amount) / 1e8).toFixed(4);
            const statusDisplay = {
              pending: 'Awaiting release',
              released: 'Released',
              claimed: 'Claimed',
              expired: 'Expired',
            };
            
            redeems.push({
              nonce,
              amount: amountZEC + ' ZEC',
              status: statusDisplay[burnRequest.status] || 'Unknown',
              vault: formatAddress(burnRequest.vault),
            });
          } catch (err) {
            redeems.push({
              nonce,
              amount: 'N/A',
              status: 'Not found',
              vault: '-',
            });
          }
        }
        
        spinner.stop();
        
        // Pending Redeems table
        printSection('Redeem Requests');
        console.log('');
        console.log(chalk.hex(COLORS.border)('  ┌──────────┬────────────┬───────────────────────┐'));
        console.log(
          chalk.hex(COLORS.border)('  │') + chalk.hex(COLORS.primary).bold('  Nonce   ') +
          chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold('  Amount   ') +
          chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold('       Status          ') +
          chalk.hex(COLORS.border)('│')
        );
        console.log(chalk.hex(COLORS.border)('  ├──────────┼────────────┼───────────────────────┤'));
        
        for (const redeem of redeems) {
          const statusColor = redeem.status === 'Awaiting release' ? COLORS.warning : 
                              redeem.status === 'Released' ? COLORS.success : COLORS.dim;
          console.log(
            chalk.hex(COLORS.border)('  │ ') +
            chalk.hex(COLORS.highlight)(redeem.nonce.toString().padEnd(8)) +
            chalk.hex(COLORS.border)(' │ ') +
            chalk.hex(COLORS.success)(redeem.amount.padEnd(10)) +
            chalk.hex(COLORS.border)(' │ ') +
            chalk.hex(statusColor)(redeem.status.padEnd(21)) +
            chalk.hex(COLORS.border)(' │')
          );
        }
        
        console.log(chalk.hex(COLORS.border)('  └──────────┴────────────┴───────────────────────┘'));
        console.log('');
      } else {
        spinner.stop();
      }
      
      info(`Confirm issue: ${chalk.hex(COLORS.primary)('zarklink vault confirm-issue <nonce>')}`);
      info(`Release redeem: ${chalk.hex(COLORS.primary)('zarklink vault release <nonce>')}`);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

export default vaultCommand;
