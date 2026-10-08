/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    {describe, it} = require('node:test');

const {KNOWN_OPTIONS, TEST_OPTIONS} = require('../lib/common');

//------------------------
// The hand-written .d.ts files are read as text, so this check needs no TypeScript. It relies on
// their layout: namespace members at a 4-space indent, and interface properties at 8 spaces.
//------------------------
function readDts(name) {
    return fs.readFileSync(path.resolve(__dirname, '..', `${name}.d.ts`), 'utf8');
}

function interfaceKeys(src, name) {
    const body = src.match(
        new RegExp(`^ {4}interface ${name}\\b[^{]*\\{\\n([\\s\\S]*?)^ {4}\\}`, 'm')
    );
    assert.ok(body, `interface ${name} not found`);
    return [...body[1].matchAll(/^ {8}(\w+)\??:/gm)].map(m => m[1]);
}

function valueExports(src) {
    return [...src.matchAll(/^ {4}(?:const|function) (\w+)/gm)].map(m => m[1]);
}

const sorted = arr => [...arr].sort();

describe('configureRsbuild.d.ts', () => {
    const src = readDts('configureRsbuild');

    it('declares every option in KNOWN_OPTIONS, and no others', () => {
        const declared = [...interfaceKeys(src, 'SharedEnv'), ...interfaceKeys(src, 'RsbuildEnv')];
        assert.deepEqual(sorted(declared), sorted(KNOWN_OPTIONS));
    });

    it('declares the named exports of configureRsbuild.js', () => {
        assert.deepEqual(
            sorted(valueExports(src)),
            sorted(Object.keys(require('../configureRsbuild')))
        );
    });
});

describe('configureVitest.d.ts', () => {
    const src = readDts('configureVitest');

    it('declares every option in TEST_OPTIONS on top of the shared options, and no others', () => {
        assert.deepEqual(sorted(interfaceKeys(src, 'VitestEnv')), sorted(TEST_OPTIONS));
        assert.match(src, /interface VitestEnv extends configureRsbuild\.SharedEnv \{/);
    });

    it('declares the named exports of configureVitest.js', () => {
        assert.deepEqual(
            sorted(valueExports(src)),
            sorted(Object.keys(require('../configureVitest')))
        );
    });
});
