require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const Table = require('cli-table3');

const { ensureDirs, DIRS } = require('./config');
const { runPost } = require('./poster');
const { loadSchedule, saveSchedule, to12h } = require('./schedule-config');

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(date) {
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getVideos(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    .map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, caption: f.slice(0, -4), size: stat.size, date: stat.mtime };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── header ─────────────────────────────────────────────────────────────────

function printHeader() {
  const ready  = getVideos(DIRS.videos).length;
  const posted = getVideos(DIRS.posted).length;
  const failed = getVideos(DIRS.failed).length;
  const times  = loadSchedule().map(to12h).join('  |  ');

  console.log(chalk.cyan('┌─────────────────────────────────────────┐'));
  console.log(chalk.cyan('│') + chalk.bold.white('           BopperX Dashboard           ') + chalk.cyan('│'));
  console.log(chalk.cyan('└─────────────────────────────────────────┘'));
  console.log();

  const dot = (color, label, n) =>
    `  ${chalk[color]('•')} ${chalk.gray(label.padEnd(14))} ${chalk[color].bold(n)} video${n !== 1 ? 's' : ''}`;

  console.log(dot('green',  'Ready to post:',  ready));
  console.log(dot('blue',   'Posted:',          posted));
  console.log(dot('red',    'Failed:',          failed));
  console.log();
  console.log(`  ${chalk.gray('Schedule:')}  ${chalk.yellow(times)}`);
  console.log();
}

// ─── video table ─────────────────────────────────────────────────────────────

function printVideoTable(videos, emptyMsg) {
  if (videos.length === 0) {
    console.log(chalk.gray(`  ${emptyMsg}`));
    return;
  }

  const table = new Table({
    head: [
      chalk.white.bold('#'),
      chalk.white.bold('Caption'),
      chalk.white.bold('Size'),
      chalk.white.bold('Date'),
    ],
    style: { border: ['gray'], head: [] },
    colWidths: [4, 44, 9, 22],
    wordWrap: false,
  });

  videos.forEach((v, i) => {
    const caption = v.caption.length > 42 ? v.caption.slice(0, 41) + '…' : v.caption;
    table.push([
      chalk.gray(i + 1),
      chalk.white(caption),
      chalk.cyan(fmtBytes(v.size)),
      chalk.gray(fmtDate(v.date)),
    ]);
  });

  console.log(table.toString());
}

// ─── screens ────────────────────────────────────────────────────────────────

async function viewQueue(dirKey, title, emptyMsg) {
  console.clear();
  const videos = getVideos(DIRS[dirKey]);
  console.log(chalk.bold(`\n  ${title}  (${videos.length} video${videos.length !== 1 ? 's' : ''})\n`));
  printVideoTable(videos, emptyMsg);

  if (dirKey === 'videos' && videos.length > 0) {
    console.log(`\n  ${chalk.gray('Next to post:')} ${chalk.green(videos[0].caption)}`);
  }

  console.log();
  await inquirer.prompt([{ type: 'input', name: '_', message: 'Press Enter to go back...' }]);
}

async function postNow() {
  console.clear();
  console.log(chalk.bold('\n  Manual Post\n'));

  const videos = getVideos(DIRS.videos);
  if (videos.length === 0) {
    console.log(chalk.yellow('  Queue is empty. Add .mp4 files to /videos and try again.'));
    console.log();
    await inquirer.prompt([{ type: 'input', name: '_', message: 'Press Enter to go back...' }]);
    return;
  }

  const next = videos[0];
  console.log(`  File:    ${chalk.cyan(next.name)}`);
  console.log(`  Caption: ${chalk.white(`"${next.caption}"`)}`);
  console.log(`  Size:    ${chalk.cyan(fmtBytes(next.size))}`);
  console.log();

  const { ok } = await inquirer.prompt([{
    type: 'confirm',
    name: 'ok',
    message: 'Post this video now?',
    default: false,
  }]);

  if (!ok) return;

  console.log();
  await runPost();
  console.log();
  await inquirer.prompt([{ type: 'input', name: '_', message: 'Press Enter to go back...' }]);
}

async function configureSchedule() {
  console.clear();
  console.log(chalk.bold('\n  Configure Schedule\n'));

  const current = loadSchedule();
  console.log(`  Current: ${chalk.yellow(current.map(to12h).join('  |  '))}\n`);

  // Hourly options 5 AM – 11 PM
  const options = [];
  for (let h = 5; h <= 23; h++) {
    const key = `${h.toString().padStart(2, '0')}:00`;
    options.push({ name: to12h(key), value: key, checked: current.includes(key) });
  }

  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message: 'Select posting times (Space to toggle, Enter to confirm):',
    choices: options,
    pageSize: 12,
    validate: (v) => v.length > 0 || 'Pick at least one time.',
  }]);

  selected.sort();
  saveSchedule(selected);

  console.log(chalk.green(`\n  Saved: ${selected.map(to12h).join('  |  ')}`));
  console.log(chalk.gray('  The running scheduler will pick this up automatically.\n'));
  await inquirer.prompt([{ type: 'input', name: '_', message: 'Press Enter to go back...' }]);
}

async function viewLogs() {
  console.clear();
  const today = new Date().toISOString().split('T')[0];
  const logPath = path.join(DIRS.logs, `${today}.log`);

  console.log(chalk.bold(`\n  Log — ${today}\n`));

  if (!fs.existsSync(logPath)) {
    console.log(chalk.gray('  No log entries yet today.'));
  } else {
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').slice(-40);
    lines.forEach((line) => {
      if      (line.includes('[SUCCESS]')) console.log(chalk.green(`  ${line}`));
      else if (line.includes('[ERROR]'))   console.log(chalk.red(`  ${line}`));
      else if (line.includes('[WARN]'))    console.log(chalk.yellow(`  ${line}`));
      else                                 console.log(chalk.gray(`  ${line}`));
    });
  }

  console.log();
  await inquirer.prompt([{ type: 'input', name: '_', message: 'Press Enter to go back...' }]);
}

// ─── main loop ───────────────────────────────────────────────────────────────

async function main() {
  ensureDirs();

  while (true) {
    console.clear();
    printHeader();

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Choose an action:',
      choices: [
        { name: 'View ready queue',      value: 'ready'    },
        { name: 'View posted videos',    value: 'posted'   },
        { name: 'View failed videos',    value: 'failed'   },
        new inquirer.Separator(),
        { name: 'Post now  (manual)',    value: 'post'     },
        { name: 'Change schedule times', value: 'schedule' },
        { name: "View today's logs",     value: 'logs'     },
        new inquirer.Separator(),
        { name: 'Exit',                  value: 'exit'     },
      ],
    }]);

    switch (action) {
      case 'ready':    await viewQueue('videos', 'Ready Queue',     'No videos queued yet.'); break;
      case 'posted':   await viewQueue('posted', 'Posted Videos',   'Nothing posted yet.');   break;
      case 'failed':   await viewQueue('failed', 'Failed Videos',   'No failures — nice!');   break;
      case 'post':     await postNow();        break;
      case 'schedule': await configureSchedule(); break;
      case 'logs':     await viewLogs();       break;
      case 'exit':     console.clear(); process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error(chalk.red('\nFatal error:'), err.message);
  process.exit(1);
});
