#!/usr/bin/env node
import { writeConfigTemplate } from './config.js';

const command = process.argv[2];

try {
  if (command === 'init') {
    await writeConfigTemplate();
    console.log('已创建 ssh-release.config.ts');
    process.exit(0);
  }

  if (command === 'deploy' || command === 'rollback' || command === 'list' || command === 'doctor') {
    console.error(`命令尚未实现: ${command}`);
    process.exit(1);
  }

  console.log(`用法:
  ssh-release init
  ssh-release deploy
  ssh-release rollback [version]
  ssh-release list
  ssh-release doctor`);
  process.exit(command ? 1 : 0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
