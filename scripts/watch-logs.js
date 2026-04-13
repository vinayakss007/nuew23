#!/usr/bin/env node

/**
 * NuCRM Live Log Watcher
 * 
 * Usage:
 *   node scripts/watch-logs.js          # Watch all logs
 *   node scripts/watch-logs.js error    # Watch only errors
 *   node scripts/watch-logs.js --grep "user"  # Filter by keyword
 *   node scripts/watch-logs.js --json   # Output as JSON
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'nucrm.log');
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
};

function colorize(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

function formatTimestamp(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString('en-US', { hour12: false });
}

function parseLogLine(line) {
  try {
    // Try parsing as JSON (structured logs)
    return JSON.parse(line);
  } catch {
    // Plain text log
    return { message: line, level: 'info', ts: new Date().toISOString() };
  }
}

function formatLog(log, options = {}) {
  const { json, grep } = options;
  
  // Apply grep filter
  if (grep && !log.message.toLowerCase().includes(grep.toLowerCase())) {
    return null;
  }

  if (json) {
    return JSON.stringify(log);
  }

  const time = colorize(formatTimestamp(log.ts || new Date()), 'dim');
  const level = log.level?.toUpperCase() || 'INFO';
  
  let levelBadge;
  switch (level.toLowerCase()) {
    case 'error':
    case 'fatal':
      levelBadge = colorize(` ${level} `, 'bgRed');
      break;
    case 'warn':
    case 'warning':
      levelBadge = colorize(` ${level} `, 'bgYellow');
      break;
    case 'info':
      levelBadge = colorize(` ${level} `, 'bgBlue');
      break;
    case 'success':
      levelBadge = colorize(` ${level} `, 'bgGreen');
      break;
    default:
      levelBadge = colorize(` ${level} `, 'bgBlue');
  }

  let message = log.message || '';
  
  // Colorize common patterns in message
  if (message.includes('Error') || message.includes('failed')) {
    message = colorize(message, 'red');
  } else if (message.includes('Warning') || message.includes('slow')) {
    message = colorize(message, 'yellow');
  } else if (message.includes('success') || message.includes('✅')) {
    message = colorize(message, 'green');
  }

  let meta = '';
  if (log.userId) {
    meta += ` ${colorize(`user:${log.userId}`, 'cyan')}`;
  }
  if (log.tenantId) {
    meta += ` ${colorize(`tenant:${log.tenantId}`, 'cyan')}`;
  }
  if (log.duration) {
    meta += ` ${colorize(`${log.duration}ms`, 'yellow')}`;
  }

  return `${time} ${levelBadge} ${message}${meta}`;
}

function watchLogs(options = {}) {
  const { level, grep, json } = options;
  
  console.log(colorize('\n🔍 NuCRM Live Log Watcher\n', 'bright'));
  console.log(colorize('Watching:', 'dim'), LOG_FILE);
  if (level) console.log(colorize('Level filter:', 'dim'), level);
  if (grep) console.log(colorize('Keyword filter:', 'dim'), grep);
  console.log(colorize('Press Ctrl+C to stop\n', 'dim'));

  // Create log file if it doesn't exist
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
  }

  // Read existing logs (last 100 lines)
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n').filter(Boolean).slice(-100);
    
    lines.forEach(line => {
      const log = parseLogLine(line);
      if (!level || log.level?.toLowerCase() === level.toLowerCase()) {
        const formatted = formatLog(log, { json, grep });
        if (formatted) console.log(formatted);
      }
    });
    
    if (lines.length > 0) {
      console.log(colorize('\n--- Live stream starts here ---\n', 'cyan'));
    }
  } catch (err) {
    // File might be empty
  }

  // Watch for new content
  let currentSize = fs.statSync(LOG_FILE).size;
  
  setInterval(() => {
    try {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > currentSize) {
        const fd = fs.openSync(LOG_FILE, 'r');
        const buffer = Buffer.alloc(stats.size - currentSize);
        fs.readSync(fd, buffer, 0, buffer.length, currentSize);
        fs.closeSync(fd);
        
        const newContent = buffer.toString('utf8');
        const newLines = newContent.split('\n').filter(Boolean);
        
        newLines.forEach(line => {
          const log = parseLogLine(line);
          if (!level || log.level?.toLowerCase() === level.toLowerCase()) {
            const formatted = formatLog(log, { json, grep });
            if (formatted) console.log(formatted);
          }
        });
        
        currentSize = stats.size;
      }
    } catch (err) {
      // File might have been rotated
    }
  }, 500);
}

// Parse CLI arguments
const args = process.argv.slice(2);
const options = {
  level: null,
  grep: null,
  json: args.includes('--json'),
};

// Check for --grep flag
const grepIndex = args.indexOf('--grep');
if (grepIndex !== -1 && args[grepIndex + 1]) {
  options.grep = args[grepIndex + 1];
}

// First non-flag argument is the level filter
const levelArg = args.find(arg => !arg.startsWith('--'));
if (levelArg) {
  options.level = levelArg;
}

// Start watching
watchLogs(options);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(colorize('\n\n👋 Log watcher stopped', 'dim'));
  process.exit(0);
});
