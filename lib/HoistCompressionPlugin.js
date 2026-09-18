/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

const zlib = require('zlib'),
    {promisify} = require('util');

/**
 * Emits a pre-compressed copy of each matching output asset alongside the original, for direct
 * serving by nginx via `brotli_static` / `gzip_static`. One instance per algorithm.
 *
 * A small in-house stand-in for `compression-webpack-plugin`, which declares webpack as a required
 * peer dependency - an install-time warning (pnpm, yarn) or an unwanted webpack install (npm) in an
 * Rspack-only toolchain. Written against the same webpack-compatible compilation API that plugin
 * uses, and tags assets the same way (`compressed: true` on the copy, `related.gzipped` /
 * `related.brotliCompressed` on the original) so Rspack's stats output treats them alike.
 * Originals are always kept: a client that advertises neither encoding still needs a file to read.
 */
class HoistCompressionPlugin {
    /**
     * @param {Object} opts
     * @param {'gzip'|'brotliCompress'} opts.algorithm - async `zlib` method used to compress.
     * @param {string} opts.extension - appended to the original filename, e.g. `.br`.
     * @param {Object} [opts.compressionOptions] - options passed to the `zlib` method.
     * @param {RegExp|string|Function|Array} [opts.test] - asset names to compress. Same semantics as
     *      webpack's `ModuleFilenameHelpers.matchObject`, as do `include` and `exclude`.
     * @param {RegExp|string|Function|Array} [opts.include]
     * @param {RegExp|string|Function|Array} [opts.exclude]
     * @param {number} [opts.threshold=0] - skip assets smaller than this many bytes.
     * @param {number} [opts.minRatio=0.8] - skip assets whose compressed size does not fall to this
     *      fraction of the original or below.
     */
    constructor({
        algorithm,
        extension,
        compressionOptions = {},
        test,
        include,
        exclude,
        threshold = 0,
        minRatio = 0.8
    }) {
        if (typeof zlib[algorithm] !== 'function') {
            throw `HoistCompressionPlugin: unknown zlib algorithm "${algorithm}".`;
        }
        this.algorithm = algorithm;
        this.extension = extension;
        this.compressionOptions = compressionOptions;
        this.matcher = {test, include, exclude};
        this.threshold = threshold;
        this.minRatio = minRatio;
        // Asset-info key naming the compressed twin, matching compression-webpack-plugin.
        this.relatedKey = algorithm === 'gzip' ? 'gzipped' : `${algorithm}ed`;
    }

    apply(compiler) {
        const pluginName = HoistCompressionPlugin.name,
            {Compilation, ModuleFilenameHelpers, sources} = compiler.rspack,
            {RawSource} = sources,
            matches = ModuleFilenameHelpers.matchObject.bind(undefined, this.matcher),
            compress = promisify(zlib[this.algorithm]);

        compiler.hooks.thisCompilation.tap(pluginName, compilation => {
            compilation.hooks.processAssets.tapPromise(
                {
                    name: pluginName,
                    // After minification (OPTIMIZE_SIZE), as compression-webpack-plugin runs. With
                    // `additionalAssets`, also called for assets other plugins emit later.
                    stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER,
                    additionalAssets: true
                },
                async assets => {
                    const tasks = Object.keys(assets).map(async name => {
                        const asset = compilation.getAsset(name);
                        if (!asset) return;
                        const {source, info} = asset;
                        if (info.compressed || info.related?.[this.relatedKey] || !matches(name)) {
                            return;
                        }

                        const input = source.buffer();
                        if (input.length < this.threshold) return;

                        let output;
                        try {
                            output = await compress(input, this.compressionOptions);
                        } catch (e) {
                            compilation.errors.push(
                                new Error(
                                    `${pluginName}: failed to compress ${name} - ${e.message}`
                                )
                            );
                            return;
                        }
                        if (output.length / input.length > this.minRatio) return;

                        const twin = `${name}${this.extension}`;
                        compilation.emitAsset(twin, new RawSource(output), {
                            compressed: true,
                            ...(info.immutable ? {immutable: true} : {})
                        });
                        compilation.updateAsset(name, source, {
                            related: {[this.relatedKey]: twin}
                        });
                    });
                    await Promise.all(tasks);
                }
            );
        });
    }
}

module.exports = HoistCompressionPlugin;
