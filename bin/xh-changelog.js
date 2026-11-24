#!/usr/bin/env node
/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

process.exitCode = require('../lib/changelog/cli').run(process.argv.slice(2));
