/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

const assert = require('node:assert/strict'),
    {describe, it} = require('node:test'),
    {rspack} = require('@rsbuild/core');

const {hoistMinifyOptions} = require('../lib/hoistCompile');

/**
 * Minify `src` with the installed Rspack and Hoist's options, run it and return what it stored in
 * `globalThis.__result`. Dev builds do not minify, so these checks stand in for a production build.
 */
function minifyAndRun(src) {
    const {code} = rspack.experiments.swc.minifySync(src, hoistMinifyOptions());
    globalThis.__result = undefined;
    new Function(code)();
    return globalThis.__result;
}

describe(`SWC minifier with Hoist options (@rspack/core ${rspack.rspackVersion})`, () => {
    // web-infra-dev/rspack#16586 - broken in 2.3.2.
    it('keeps a static self-reference inside a class', () => {
        const result = minifyAndRun(`(function () {
            class Base {}
            class NumericInput extends Base {
                static VALUE_EMPTY = '';
                static defaultProps = {defaultValue: NumericInput.VALUE_EMPTY};
            }
            function namedFn() { return NumericInput.defaultProps; }
            globalThis.__result = [NumericInput.name, namedFn.name, namedFn().defaultValue];
        })();`);
        assert.deepEqual(result, ['NumericInput', 'namedFn', '']);
    });

    // swc-project/swc#12770, web-infra-dev/rspack#16695 - broken in 2.3.2 and 2.3.3.
    it('does not give a local the same name as a kept class name', () => {
        const result = minifyAndRun(`(function () {
            const cache = new WeakMap();
            class l {
                static lookup(key) { return cache.get(key); }
            }
            cache.set(globalThis, 'found');
            globalThis.__result = [l.lookup(globalThis), l.name];
        })();`);
        assert.deepEqual(result, ['found', 'l']);
    });
});
