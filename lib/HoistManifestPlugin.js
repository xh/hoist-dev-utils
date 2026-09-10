/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
'use strict';

/**
 * Emits a client-app specific manifest.json within /public, to avoid issues with deeper routes
 * and relative paths. Picked up by this package's /static/index.html template. Written against
 * the webpack compilation API, which Rspack implements - `compiler.webpack` is aliased to the
 * Rspack namespace there, so one plugin serves both `configureWebpack()` and `configureRsbuild()`.
 */
class HoistManifestPlugin {
    constructor(clientAppName, content = {}) {
        this.clientAppName = clientAppName;
        this.content = content;
    }

    apply(compiler) {
        const pluginName = HoistManifestPlugin.name,
            {Compilation, sources} = compiler.webpack ?? compiler.rspack,
            {RawSource} = sources;

        compiler.hooks.compilation.tap(pluginName, compilation => {
            compilation.hooks.processAssets.tap(
                {
                    name: pluginName,
                    stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
                },
                () => {
                    compilation.emitAsset(
                        `/public/${this.clientAppName}/manifest.json`,
                        new RawSource(JSON.stringify(this.content, null, 2))
                    );
                }
            );
        });
    }
}

module.exports = HoistManifestPlugin;
