#!/usr/bin/env node

import { createRequire } from 'node:module';
import { program } from 'commander';
import { authCommand } from '../lib/commands/auth.mjs';
import { ordersCommand } from '../lib/commands/orders.mjs';
import { trackCommand } from '../lib/commands/track.mjs';
import { returnsCommand } from '../lib/commands/returns.mjs';
import { spendingCommand } from '../lib/commands/spending.mjs';
import { searchCommand } from '../lib/commands/search.mjs';
import { similarCommand } from '../lib/commands/similar.mjs';
import { reorderCommand } from '../lib/commands/reorder.mjs';
import { checkoutCommand } from '../lib/commands/checkout.mjs';
import { shippingCommand } from '../lib/commands/shipping.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

program
  .name('shop')
  .description('Shop: search, buy, and manage orders from millions of online stores')
  .version(version);

authCommand(program);
searchCommand(program);
similarCommand(program);
ordersCommand(program);
trackCommand(program);
returnsCommand(program);
reorderCommand(program);
checkoutCommand(program);
spendingCommand(program);
shippingCommand(program);

program.parse();
