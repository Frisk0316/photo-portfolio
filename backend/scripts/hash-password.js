import bcrypt from 'bcrypt';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

const password = process.argv.slice(2).join(' ');

async function readPassword() {
  if (password) return password;

  const rl = createInterface({ input, output });
  try {
    return await rl.question('Admin password to hash: ');
  } finally {
    rl.close();
  }
}

const plainText = await readPassword();

if (!plainText) {
  console.error('Password is required.');
  process.exit(1);
}

const hash = await bcrypt.hash(plainText, 12);
console.log(hash);
