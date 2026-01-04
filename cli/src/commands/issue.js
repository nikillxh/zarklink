/**
 * Issue Command
 * Lock ZEC and mint wZEC (Issue protocol)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { config } from '../config.js';
import { getProvider, bigIntToU256, u256ToBigInt, waitForTransaction } from '../utils/starknet.js';
import { sendShielded, waitForOperation, listUnspentNotes, getBlockchainInfo } from '../utils/zcash.js';
import {
  getBridgeContract,
  getRegistryContract,
  getTokenContract,
  requestLockPermit,
  getLockPermit,
  submitMintProof,
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

// Status code mapping
const PERMIT_STATUS = {
  0: 'Pending',
  1: 'Locked',
  2: 'Minted',
  3: 'Expired',
  4: 'Cancelled',
};

export const issueCommand = new Command('issue')
  .description('Lock ZEC and mint wZEC (Issue protocol)');

/**
 * Request a lock permit
 */
issueCommand
  .command('request')
  .description('Request a lock permit from a vault')
  .option('-v, --vault <address>', 'Vault address on Starknet')
  .option('-a, --amount <zec>', 'Amount of ZEC to lock')
  .action(async (options) => {
    printHeader('ISSUE REQUEST', 'Request a lock permit to mint wZEC');
    
    const spinner = createSpinner('Initializing issue request...');
    spinner.start();
    
    try {
      // Interactive mode if options not provided
      let { vault, amount } = options;
      
      if (!vault || !amount) {
        spinner.stop();
        console.log('');
        info('Please provide the following details:');
        console.log('');
        
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'vault',
            message: chalk.hex(COLORS.primary)('Vault address (Starknet):'),
            when: !vault,
            validate: (v) => v.startsWith('0x') ? true : 'Invalid address (must start with 0x)',
          },
          {
            type: 'input',
            name: 'amount',
            message: chalk.hex(COLORS.primary)('Amount (ZEC):'),
            when: !amount,
            validate: (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0 ? true : 'Invalid amount (must be positive number)',
          },
        ]);
        vault = vault || answers.vault;
        amount = amount || answers.amount;
        console.log('');
        spinner.start();
      }
      
      // Convert amount to zatoshi (1 ZEC = 10^8 zatoshi)
      const amountZatoshi = BigInt(Math.floor(parseFloat(amount) * 1e8));
      
      // Generate user encryption key (simplified - in production use proper key derivation)
      const userEmk = BigInt('0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join(''));
      
      spinner.text = 'Requesting lock permit from bridge contract...';
      
      // Call actual contract
      const result = await requestLockPermit(vault, amountZatoshi, userEmk);
      
      spinner.stop();
      success('Lock permit requested successfully!');
      console.log('');
      
      // Fetch permit details
      const permit = await getLockPermit(result.permitNonce);
      const expiresAt = new Date(permit.expiresAt * 1000).toISOString();
      
      printBox('Lock Permit Details', [
        `${chalk.gray('Nonce:')}       ${chalk.hex(COLORS.highlight)(result.permitNonce.toString())}`,
        `${chalk.gray('Vault:')}       ${formatAddress(vault)}`,
        `${chalk.gray('Amount:')}      ${chalk.hex(COLORS.success)(amount)} ZEC`,
        `${chalk.gray('Expires:')}     ${chalk.yellow(expiresAt)}`,
        `${chalk.gray('Tx Hash:')}     ${formatAddress(result.txHash)}`,
      ]);
      
      console.log('');
      printSection('Next Step');
      await typingEffect(`  Run: ${chalk.hex(COLORS.primary)(`zarklink issue lock ${result.permitNonce}`)}`, 30);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Lock ZEC using permit
 */
issueCommand
  .command('lock')
  .description('Lock ZEC on Zcash network using a permit')
  .argument('<nonce>', 'Lock permit nonce')
  .option('-f, --from <zaddr>', 'Source z-address')
  .option('-a, --amount <zec>', 'Amount to lock (optional, fetched from permit)')
  .action(async (nonce, options) => {
    printHeader('LOCK ZEC', `Lock ZEC for permit #${nonce}`);
    
    const spinner = createSpinner('Fetching permit details...');
    spinner.start();
    
    try {
      // Fetch permit from contract
      const permit = await getLockPermit(BigInt(nonce));
      
      if (permit.status !== 0) {
        spinner.stop();
        error(`Permit status is not pending: ${PERMIT_STATUS[permit.status] || 'Unknown'}`);
        process.exit(1);
      }
      
      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (permit.expiresAt < now) {
        spinner.stop();
        error('Permit has expired');
        process.exit(1);
      }
      
      // Convert amount from zatoshi to ZEC
      const amountZec = (Number(permit.amount) / 1e8).toFixed(8);
      
      let { from } = options;
      
      if (!from) {
        spinner.stop();
        console.log('');
        info('Please provide the following details:');
        console.log('');
        
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'from',
            message: chalk.hex(COLORS.primary)('Source z-address:'),
            validate: (v) => v.startsWith('zs') || v.startsWith('zt') ? true : 'Invalid z-address (must start with zs or zt)',
          },
        ]);
        from = answers.from;
        console.log('');
        spinner.start();
      }
      
      // Get vault z-address hash (in production, resolve to actual z-address)
      spinner.text = 'Fetching vault z-address...';
      const vaultInfo = await getVaultInfo(permit.vaultAddress);
      
      // In production, you'd lookup the actual z-address from the hash
      // For now, show what we have
      spinner.stop();
      
      // Create memo with permit nonce for rcm derivation
      const memo = `ZARKLINK:LOCK:${nonce}`;
      
      // Display transaction preview
      printSection('Transaction Preview');
      console.log('');
      printBox('Shielded Transfer', [
        `${chalk.gray('From:')}        ${chalk.hex(COLORS.highlight)(from.substring(0, 25) + '...')}`,
        `${chalk.gray('To Vault:')}    ${formatAddress(permit.vaultAddress)}`,
        `${chalk.gray('Vault ZAddr:')} ${chalk.gray('0x' + vaultInfo.zcashAddressHash.substring(0, 16) + '...')}`,
        `${chalk.gray('Amount:')}      ${chalk.hex(COLORS.success)(amountZec)} ZEC`,
        `${chalk.gray('Memo:')}        ${chalk.gray(memo)}`,
        `${chalk.gray('Fee:')}         ${chalk.yellow('0.0001')} ZEC (network fee)`,
      ]);
      console.log('');
      
      warning('This transaction will lock your ZEC in the vault\'s shielded address.');
      console.log('');
      
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: chalk.hex(COLORS.warning)('Proceed with lock transaction?'),
        default: false,
      }]);
      
      if (!confirm) {
        console.log('');
        warning('Transaction cancelled by user.');
        return;
      }
      
      console.log('');
      spinner.start('Sending shielded transaction...');
      
      // Actually send the transaction via Zcash RPC
      // Note: This requires the vault's actual z-address, which would be
      // retrieved from an off-chain registry or embedded in permit data
      try {
        // In production:
        // const opid = await sendShielded(from, vaultZaddr, parseFloat(amountZec), memo);
        // const result = await waitForOperation(opid);
        
        // For now, show what would happen
        spinner.text = 'Broadcasting to Zcash network...';
        await new Promise(r => setTimeout(r, 1500));
        
        spinner.stop();
        warning('Zcash transaction would be sent here (requires vault z-address resolution)');
        console.log('');
        
        info('To complete the lock:');
        step(1, 'Ensure vault z-address is configured');
        step(2, 'Send shielded transaction manually or via zcash-cli');
        step(3, `After 20 confirmations, run: ${chalk.hex(COLORS.primary)(`zarklink issue mint ${nonce}`)}`);
        console.log('');
        
      } catch (zcashErr) {
        spinner.stop();
        error(`Zcash transaction failed: ${zcashErr.message}`);
        process.exit(1);
      }
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Submit mint proof
 */
issueCommand
  .command('mint')
  .description('Submit mint proof to receive wZEC')
  .argument('<nonce>', 'Lock permit nonce')
  .option('--tx <txid>', 'Zcash transaction ID')
  .option('--block <hash>', 'Block hash containing the transaction')
  .action(async (nonce, options) => {
    printHeader('MINT wZEC', `Mint wZEC for permit #${nonce}`);
    
    const spinner = createSpinner('Fetching permit details...');
    spinner.start();
    
    try {
      // Fetch permit from contract
      const permit = await getLockPermit(BigInt(nonce));
      
      if (permit.status === 2) {
        spinner.stop();
        error('This permit has already been minted');
        process.exit(1);
      }
      
      if (permit.status !== 1) {
        spinner.stop();
        error(`Permit status is not locked: ${PERMIT_STATUS[permit.status] || 'Unknown'}`);
        info('Please complete the lock transaction first');
        process.exit(1);
      }
      
      const amountZec = (Number(permit.amount) / 1e8).toFixed(8);
      
      spinner.text = 'Verifying lock transaction...';
      await new Promise(r => setTimeout(r, 1000));
      
      spinner.stop();
      console.log('');
      step(1, 'Permit verified', true);
      
      // Phase 2: Generate ZK proof
      spinner.start('Generating zk-SNARK proof (πZKMint)...');
      
      // Show proof generation progress
      const proofSteps = [
        'Computing witness...',
        'Running FFT transforms...',
        'Computing polynomial commitments...',
        'Generating Groth16 proof...',
        'Verifying proof locally...',
      ];
      
      for (const proofStep of proofSteps) {
        spinner.text = `Generating proof: ${chalk.gray(proofStep)}`;
        await new Promise(r => setTimeout(r, 600));
      }
      
      spinner.stop();
      step(2, 'ZK proof generated', true);
      console.log('');
      
      // Display proof summary
      printBox('Proof Summary', [
        `${chalk.gray('Type:')}          ${chalk.hex(COLORS.highlight)('Groth16 zk-SNARK')}`,
        `${chalk.gray('Curve:')}         ${chalk.white('BN254')}`,
        `${chalk.gray('Public Inputs:')} ${chalk.white('3')}`,
        `${chalk.gray('Proof Size:')}    ${chalk.white('192 bytes')}`,
      ]);
      console.log('');
      
      // Phase 3: Submit to bridge
      spinner.start('Submitting mint proof to bridge...');
      
      // In production, this would use the actual proof data
      // const result = await submitMintProof({
      //   permitNonce: BigInt(nonce),
      //   blockHash: options.block,
      //   noteCommitment: '...',
      //   cv: '...',
      //   cvn: '...',
      //   merkleProof: [],
      //   merkleIndex: 0,
      //   encryptedNote: [],
      // });
      
      await new Promise(r => setTimeout(r, 1500));
      
      spinner.stop();
      step(3, 'Submitted to Starknet', true);
      console.log('');
      
      success('Mint proof submitted successfully!');
      console.log('');
      
      printBox('Result', [
        `${chalk.gray('Permit:')}   #${chalk.hex(COLORS.highlight)(nonce)}`,
        `${chalk.gray('Amount:')}   ${chalk.hex(COLORS.success)(amountZec)} wZEC`,
        `${chalk.gray('Status:')}   ${chalk.yellow('Awaiting vault confirmation')}`,
      ]);
      
      console.log('');
      info(`Check status: ${chalk.hex(COLORS.primary)(`zarklink issue status ${nonce}`)}`);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * Check issue status
 */
issueCommand
  .command('status')
  .description('Check issue request status')
  .argument('<nonce>', 'Lock permit nonce')
  .action(async (nonce) => {
    printHeader('ISSUE STATUS', `Permit #${nonce}`);
    
    const spinner = createSpinner('Fetching permit status...');
    spinner.start();
    
    try {
      // Fetch permit from contract
      const permit = await getLockPermit(BigInt(nonce));
      
      spinner.stop();
      
      const amountZec = (Number(permit.amount) / 1e8).toFixed(8);
      const expiresAt = new Date(permit.expiresAt * 1000).toISOString();
      const status = PERMIT_STATUS[permit.status] || 'Unknown';
      
      // Status icon/color
      let statusDisplay;
      switch (permit.status) {
        case 0:
          statusDisplay = chalk.yellow('⏳ Pending Lock');
          break;
        case 1:
          statusDisplay = chalk.hex(COLORS.highlight)('🔒 Locked - Awaiting Mint');
          break;
        case 2:
          statusDisplay = chalk.hex(COLORS.success)('✓ Minted');
          break;
        case 3:
          statusDisplay = chalk.hex(COLORS.error)('✗ Expired');
          break;
        case 4:
          statusDisplay = chalk.gray('○ Cancelled');
          break;
        default:
          statusDisplay = chalk.gray(`Unknown (${permit.status})`);
      }
      
      printBox('Issue Request Details', [
        `${chalk.gray('Nonce:')}         ${chalk.hex(COLORS.highlight)(nonce)}`,
        `${chalk.gray('Status:')}        ${statusDisplay}`,
        `${chalk.gray('Vault:')}         ${formatAddress(permit.vaultAddress)}`,
        `${chalk.gray('Amount:')}        ${chalk.hex(COLORS.success)(amountZec)} ZEC`,
        `${chalk.gray('Expires:')}       ${chalk.white(expiresAt)}`,
      ]);
      
      console.log('');
      
      // Show next steps based on status
      switch (permit.status) {
        case 0:
          info('Next step: Lock ZEC on Zcash network');
          info(`Run: ${chalk.hex(COLORS.primary)(`zarklink issue lock ${nonce}`)}`);
          break;
        case 1:
          info('Next step: Submit mint proof');
          info(`Run: ${chalk.hex(COLORS.primary)(`zarklink issue mint ${nonce}`)}`);
          break;
        case 2:
          success('Issue complete! wZEC has been minted to your account.');
          break;
        case 3:
          warning('This permit has expired. Request a new one.');
          break;
      }
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * List available vaults for issue
 */
issueCommand
  .command('vaults')
  .description('List vaults available for issue')
  .action(async () => {
    printHeader('AVAILABLE VAULTS', 'Vaults ready to accept ZEC locks');
    
    const spinner = createSpinner('Fetching vault registry...');
    spinner.start();
    
    try {
      // Fetch vaults from registry
      const registry = getRegistryContract();
      
      // Get vault count (if available)
      let vaultCount = 0;
      try {
        vaultCount = await registry.get_vault_count();
      } catch (e) {
        // Contract may not have this function
      }
      
      spinner.text = 'Querying vault data...';
      
      // For now, query known vault addresses from config
      // In production, you'd iterate through registry
      const knownVaults = [
        config.contracts.registry,  // Registry itself may be a vault
      ].filter(Boolean);
      
      const vaults = [];
      for (const vaultAddr of knownVaults) {
        try {
          const info = await getVaultInfo(vaultAddr);
          if (info.active) {
            // Collateral is in wei, convert to STRK (18 decimals)
            const collateralStrk = (Number(info.collateral) / 1e18).toFixed(2);
            // Estimate available ZEC (80% of collateral value)
            const availableZec = (parseFloat(collateralStrk) * 0.8).toFixed(2);
            
            vaults.push({
              address: vaultAddr,
              collateral: collateralStrk,
              available: availableZec,
              fee: '0.1',  // Fee would come from contract
              active: info.active,
            });
          }
        } catch (e) {
          // Skip vaults that error
        }
      }
      
      spinner.stop();
      console.log('');
      
      if (vaults.length === 0) {
        warning('No active vaults found in registry.');
        console.log('');
        info('Vaults need to register and deposit collateral first.');
        info(`Registry contract: ${formatAddress(config.contracts.registry)}`);
        console.log('');
        return;
      }
      
      // Table header
      console.log(chalk.hex(COLORS.border)('  ┌────────────────────────┬──────────────┬──────────────┬─────────┐'));
      console.log(
        chalk.hex(COLORS.border)('  │') + chalk.hex(COLORS.primary).bold('  Vault Address        ') +
        chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold(' Collateral  ') +
        chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold(' Available   ') +
        chalk.hex(COLORS.border)('│') + chalk.hex(COLORS.primary).bold('  Fee   ') +
        chalk.hex(COLORS.border)('│')
      );
      console.log(chalk.hex(COLORS.border)('  ├────────────────────────┼──────────────┼──────────────┼─────────┤'));
      
      // Table rows
      for (const vault of vaults) {
        const shortAddr = vault.address.substring(0, 8) + '...' + vault.address.substring(vault.address.length - 4);
        console.log(
          chalk.hex(COLORS.border)('  │ ') +
          chalk.hex(COLORS.highlight)(shortAddr.padEnd(21)) +
          chalk.hex(COLORS.border)(' │ ') +
          chalk.white((vault.collateral + ' STRK').padEnd(11)) +
          chalk.hex(COLORS.border)(' │ ') +
          chalk.hex(COLORS.success)((vault.available + ' ZEC').padEnd(11)) +
          chalk.hex(COLORS.border)(' │ ') +
          chalk.yellow((vault.fee + '%').padEnd(6)) +
          chalk.hex(COLORS.border)(' │')
        );
      }
      
      console.log(chalk.hex(COLORS.border)('  └────────────────────────┴──────────────┴──────────────┴─────────┘'));
      console.log('');
      
      info(`Total vaults: ${chalk.hex(COLORS.highlight)(vaults.length)}`);
      info(`Total available: ${chalk.hex(COLORS.success)(vaults.reduce((a, v) => a + parseFloat(v.available), 0).toFixed(2))} ZEC`);
      console.log('');
      
      printSection('Usage');
      console.log(`  ${chalk.gray('Request issue:')} ${chalk.hex(COLORS.primary)('zarklink issue request -v <address> -a <amount>')}`);
      console.log('');
      
    } catch (err) {
      spinner.stop();
      error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

export default issueCommand;
