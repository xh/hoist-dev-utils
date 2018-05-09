const fs = require('fs'),
    path = require('path');

function browserDetectionScriptAsString(hoistPath) {
    
    let ret = fs.readFileSync(path.resolve(hoistPath, 'view/browser-detection.js'), 'utf8');
    return ret || '/* browser detection script not found. */';
}

module.exports = browserDetectionScriptAsString;