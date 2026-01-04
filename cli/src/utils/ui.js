/**
 * CLI UI Utilities
 * Consistent styling and animations for zarklink CLI
 */

import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Colors - Hex values for consistent theming
// ============================================================================

export const COLORS = {
  primary: '#00d4ff',      // Cyan - main brand color
  secondary: '#a855f7',    // Purple - secondary accent
  success: '#22c55e',      // Green - success states
  warning: '#eab308',      // Yellow - warnings
  error: '#ef4444',        // Red - errors
  info: '#3b82f6',         // Blue - info
  dim: '#6b7280',          // Gray - dimmed text
  highlight: '#f59e0b',    // Orange - highlights
  border: '#374151',       // Dark gray - borders
  text: '#f3f4f6',         // Light gray - text
};

// Chalk color helpers (for backward compatibility)
export const colors = {
  primary: chalk.hex(COLORS.primary),
  secondary: chalk.hex(COLORS.secondary),
  success: chalk.hex(COLORS.success),
  warning: chalk.hex(COLORS.warning),
  error: chalk.hex(COLORS.error),
  info: chalk.hex(COLORS.info),
  dim: chalk.hex(COLORS.dim),
  bold: chalk.bold,
  white: chalk.white,
};

// ============================================================================
// ASCII Art
// ============================================================================

export const LOGO = `
${chalk.hex(COLORS.primary)('    ███████╗ █████╗ ██████╗ ██╗  ██╗██╗     ██╗███╗   ██╗██╗  ██╗')}
${chalk.hex(COLORS.primary)('    ╚══███╔╝██╔══██╗██╔══██╗██║ ██╔╝██║     ██║████╗  ██║██║ ██╔╝')}
${chalk.hex(COLORS.primary)('      ███╔╝ ███████║██████╔╝█████╔╝ ██║     ██║██╔██╗ ██║█████╔╝ ')}
${chalk.hex(COLORS.primary)('     ███╔╝  ██╔══██║██╔══██╗██╔═██╗ ██║     ██║██║╚██╗██║██╔═██╗ ')}
${chalk.hex(COLORS.primary)('    ███████╗██║  ██║██║  ██║██║  ██╗███████╗██║██║ ╚████║██║  ██╗')}
${chalk.hex(COLORS.primary)('    ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝')}
`;

export const LOGO_SMALL = chalk.hex(COLORS.primary)(`
╔═══════════════════════════════════════════════════════════════╗
║                      ${chalk.bold('ZARKLINK')}                               ║
║           Privacy-Preserving Zcash ↔ Starknet Bridge          ║
╚═══════════════════════════════════════════════════════════════╝
`);

// ============================================================================
// Box Drawing
// ============================================================================

export function box(content, title = '', width = 70) {
  const lines = content.split('\n');
  const maxLen = Math.max(...lines.map(l => stripAnsi(l).length), width - 4);
  const innerWidth = maxLen + 2;
  
  let result = '';
  
  // Top border with title
  if (title) {
    const titleText = ` ${title} `;
    const leftPad = Math.floor((innerWidth - titleText.length) / 2);
    const rightPad = innerWidth - leftPad - titleText.length;
    result += chalk.cyan('╔' + '═'.repeat(leftPad) + chalk.bold(titleText) + '═'.repeat(rightPad) + '╗\n');
  } else {
    result += chalk.cyan('╔' + '═'.repeat(innerWidth) + '╗\n');
  }
  
  // Content
  for (const line of lines) {
    const stripped = stripAnsi(line);
    const padding = innerWidth - stripped.length - 2;
    result += chalk.cyan('║') + ' ' + line + ' '.repeat(Math.max(0, padding)) + ' ' + chalk.cyan('║\n');
  }
  
  // Bottom border
  result += chalk.cyan('╚' + '═'.repeat(innerWidth) + '╝');
  
  return result;
}

export function section(title) {
  const line = '━'.repeat(74);
  return `
${chalk.magenta(line)}
${chalk.bold.blue('  ' + title)}
${chalk.magenta(line)}
`;
}

export function subsection(title) {
  return chalk.cyan(`\n┌─ ${title} ${'─'.repeat(Math.max(0, 65 - title.length))}┐\n`);
}

// ============================================================================
// Status Indicators
// ============================================================================

export function success(msg) {
  console.log(chalk.green('  ✓ ') + msg);
}

export function error(msg) {
  console.log(chalk.red('  ✗ ') + msg);
}

export function warning(msg) {
  console.log(chalk.yellow('  ⚠ ') + msg);
}

export function info(msg) {
  console.log(chalk.cyan('  ℹ ') + msg);
}

export function bullet(msg) {
  console.log(chalk.green('  • ') + msg);
}

export function step(num, msg) {
  console.log(chalk.cyan(`  ${num}. `) + msg);
}

export function arrow(msg) {
  console.log(chalk.yellow('  → ') + msg);
}

// ============================================================================
// Progress Indicators
// ============================================================================

export function createSpinner(text) {
  return ora({
    text,
    color: 'cyan',
    spinner: {
      interval: 80,
      frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    }
  });
}

export async function withSpinner(text, fn) {
  const spinner = createSpinner(text);
  spinner.start();
  
  try {
    const result = await fn(spinner);
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail(chalk.red(err.message));
    throw err;
  }
}

export function progressBar(current, total, width = 30) {
  const percentage = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  
  const bar = chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  return `[${bar}] ${percentage}%`;
}

// ============================================================================
// Animations
// ============================================================================

export async function typewrite(text, delay = 15) {
  for (const char of text) {
    process.stdout.write(char);
    await sleep(delay);
  }
  console.log();
}

export async function animateLoading(text, duration = 500) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const startTime = Date.now();
  let i = 0;
  
  while (Date.now() - startTime < duration) {
    process.stdout.write(`\r${chalk.cyan(frames[i % frames.length])} ${text}`);
    await sleep(80);
    i++;
  }
  
  process.stdout.write(`\r${chalk.green('✓')} ${text}\n`);
}

export async function countdown(seconds, message = 'Starting in') {
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`\r${chalk.yellow(message)} ${chalk.bold(i)}...`);
    await sleep(1000);
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r');
}

// ============================================================================
// Print Functions (Aliases)
// ============================================================================

/**
 * Print a styled header with title and optional subtitle
 */
export function printHeader(title, subtitle = '') {
  console.log('');
  console.log(chalk.hex(COLORS.border)('  ╔' + '═'.repeat(66) + '╗'));
  console.log(chalk.hex(COLORS.border)('  ║') + chalk.hex(COLORS.primary).bold(`  ${title.padEnd(64)}`) + chalk.hex(COLORS.border)('║'));
  if (subtitle) {
    console.log(chalk.hex(COLORS.border)('  ║') + chalk.hex(COLORS.dim)(`  ${subtitle.padEnd(64)}`) + chalk.hex(COLORS.border)('║'));
  }
  console.log(chalk.hex(COLORS.border)('  ╚' + '═'.repeat(66) + '╝'));
  console.log('');
}

/**
 * Print a section divider
 */
export function printSection(title) {
  console.log(chalk.hex(COLORS.primary).bold(`  ▸ ${title}`));
  console.log(chalk.hex(COLORS.border)('  ' + '─'.repeat(50)));
}

/**
 * Print a styled box with content lines
 */
export function printBox(title, lines) {
  const width = 60;
  console.log(chalk.hex(COLORS.border)('  ┌─ ') + chalk.hex(COLORS.primary).bold(title) + chalk.hex(COLORS.border)(' ' + '─'.repeat(width - title.length - 4)));
  for (const line of lines) {
    console.log(chalk.hex(COLORS.border)('  │ ') + line);
  }
  console.log(chalk.hex(COLORS.border)('  └' + '─'.repeat(width)));
}

/**
 * Typing effect animation
 */
export async function typingEffect(text, delay = 25) {
  for (const char of text) {
    process.stdout.write(char);
    await sleep(delay);
  }
  console.log('');
}

/**
 * Format an address (shorten with ellipsis)
 */
export function formatAddress(address, prefixLen = 10, suffixLen = 6) {
  if (!address) return chalk.gray('(not set)');
  if (address.length <= prefixLen + suffixLen + 3) return chalk.hex(COLORS.highlight)(address);
  return chalk.hex(COLORS.highlight)(`${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`);
}

/**
 * Print animated banner
 */
export async function printBanner() {
  console.clear();
  console.log(LOGO);
  console.log(chalk.hex(COLORS.dim)('           Privacy-Preserving Zcash ↔ Starknet Bridge'));
  console.log(chalk.hex(COLORS.dim)('           ════════════════════════════════════════════'));
  console.log('');
}

// ============================================================================
// Tables
// ============================================================================

export function table(headers, rows, options = {}) {
  const { columnWidths = [] } = options;
  
  // Calculate column widths
  const widths = headers.map((h, i) => {
    if (columnWidths[i]) return columnWidths[i];
    const maxRow = Math.max(...rows.map(r => stripAnsi(String(r[i] || '')).length));
    return Math.max(stripAnsi(h).length, maxRow) + 2;
  });
  
  // Header
  let result = chalk.dim('  ');
  headers.forEach((h, i) => {
    result += chalk.bold(h.padEnd(widths[i]));
  });
  result += '\n';
  
  // Separator
  result += chalk.dim('  ' + widths.map(w => '─'.repeat(w)).join('') + '\n');
  
  // Rows
  for (const row of rows) {
    result += '  ';
    row.forEach((cell, i) => {
      const str = String(cell || '');
      const padding = widths[i] - stripAnsi(str).length;
      result += str + ' '.repeat(Math.max(0, padding));
    });
    result += '\n';
  }
  
  return result;
}

export function keyValue(pairs, indent = 2) {
  const maxKey = Math.max(...Object.keys(pairs).map(k => k.length));
  let result = '';
  
  for (const [key, value] of Object.entries(pairs)) {
    const keyStr = chalk.cyan(key.padEnd(maxKey));
    result += ' '.repeat(indent) + keyStr + '  ' + value + '\n';
  }
  
  return result;
}

// ============================================================================
// Contract Display
// ============================================================================

export function contractAddress(name, address, explorer = null) {
  const shortAddr = address ? `${address.slice(0, 10)}...${address.slice(-8)}` : chalk.dim('(not set)');
  let line = `  ${chalk.cyan(name.padEnd(16))} ${address ? chalk.white(shortAddr) : shortAddr}`;
  
  if (explorer && address) {
    line += chalk.dim(` → ${explorer}`);
  }
  
  return line;
}

export function txHash(hash, status = null) {
  const shortHash = `${hash.slice(0, 10)}...${hash.slice(-8)}`;
  let statusIcon = '';
  
  if (status === 'success' || status === 'ACCEPTED_ON_L2') {
    statusIcon = chalk.green(' ✓');
  } else if (status === 'pending' || status === 'RECEIVED') {
    statusIcon = chalk.yellow(' ⏳');
  } else if (status === 'failed' || status === 'REJECTED') {
    statusIcon = chalk.red(' ✗');
  }
  
  return chalk.white(shortHash) + statusIcon;
}

// ============================================================================
// Protocol Diagrams
// ============================================================================

export const ISSUE_FLOW = `
${chalk.cyan('  ZCASH                                      STARKNET')}
${chalk.dim('  ─────                                      ────────')}
  
  ┌─────────┐    ${chalk.yellow('1. Request Permit')}      ┌───────────┐
  │  User   │ ─────────────────────────> │  Bridge   │
  └────┬────┘                            └─────┬─────┘
       │                                       │
       │ ${chalk.yellow('2. Lock ZEC')}                          │
       ▼                                       │
  ┌─────────┐                                  │
  │  Vault  │    ${chalk.yellow('3. Block Header')}          │
  │ (z-addr)│ ──────────────────────────>│ ${chalk.yellow('Relay')}   │
  └─────────┘                            └─────┬─────┘
                                               │
  ┌─────────┐    ${chalk.yellow('4. zk-SNARK Proof')}        │
  │  User   │ ─────────────────────────> │  Bridge   │
  │         │ <──── ${chalk.green('5. Receive wZEC')} ────── │           │
  └─────────┘                            └───────────┘
`;

export const REDEEM_FLOW = `
${chalk.cyan('  STARKNET                                   ZCASH')}
${chalk.dim('  ────────                                   ─────')}
  
  ┌─────────┐    ${chalk.yellow('1. Burn wZEC')}             ┌───────────┐
  │  User   │ ─────────────────────────> │  Bridge   │
  │         │                            └─────┬─────┘
  └─────────┘                                  │
                                               │ ${chalk.yellow('2. Notify Vault')}
                                               ▼
  ┌─────────┐    ${chalk.yellow('3. Send ZEC')}              ┌───────────┐
  │  User   │ <─────────────────────────── │  Vault    │
  │ (z-addr)│                              │           │
  └─────────┘                              └─────┬─────┘
                                                 │
                    ${chalk.yellow('4. Confirm Release')}        │
              ┌───────────────────────────────────┘
              ▼
        ┌───────────┐
        │  Bridge   │ ${chalk.green('✓ Complete')}
        └───────────┘
`;

// ============================================================================
// Helpers
// ============================================================================

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { sleep };
