// SPDX-License-Identifier: MIT
// The modules this edition includes, in order (each can be turned off in MODULES). The core depends on none of them.
import { rageModule } from './rage';
import { sparksModule } from './sparks';
import type { ModuleInfo } from './index';

export const MODULES: ModuleInfo[] = [rageModule, sparksModule];
