var path = require('path');
var exec = require('child_process').exec;
var merge = require('merge');
var dargs = require('dargs');
var Writer = require('broccoli-caching-writer');
var rsvp = require('rsvp');
var fse = require('fs-extra');
var expand = require('glob-expand');

var ignoredOptions = [
      'compassCommand'
    ];

/**
 *
 * @param cmdLine
 * @param options
 * @returns {exports.Promise}
 */
function compile(cmdLine, options) {
  return new rsvp.Promise(function(resolve, reject) {
    console.log(cmdLine);
    exec(cmdLine, options, function(err, stdout, stderr) {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
}

/**
 * Copies all files except for the sass(-cache) files. Basically that is everything
 * that can be deployed further.
 * @param srcDir  The source directory where compass ran.
 * @param destDir The Broccoli destination directory
 * @param options The options used to call broccoli-compass.
 * @returns Promise[] A collection promises for each directory or file that has to be copied.
 */
function copyRelevant(srcDir, destDir, options) {
  // problem with excluding the sass dir explicitly is that this is not going to work in
  var sassDir = options.sassDir || 'sass';
  var excludes = ['!' + sassDir + '/**'];
  var result = expand({ cwd: srcDir }, ['*'].concat(excludes));
  var resLength = result.length;
  var copyPromises = [];
  for(var i = 0; i < resLength; i++){
    copyPromises.push(
      copyDir(
        path.join(srcDir, result[i]),
        path.join(destDir, result[i])));
  }
  return rsvp.all(copyPromises);
}

/**
 * A promise to copy a directory or file.
 */
function copyDir(src, dest) {
  return new rsvp.Promise(function(resolve, reject){
    //console.log('copy ' + src);
    fse.copy( src, dest,
      function(err) {
        if (err) {
          return reject(err);
        }

        resolve();
      }
    );
  });
}

/**
 * @param srcDir  The source directory where compass ran.
 * @param options The options used to call broccoli-compass.
 */
function cleanupSource(srcDir, options) {
  return new rsvp.Promise(function(resolve, reject){
    var result = expand({ cwd: srcDir }, '**/*.css', '.sass-cache');
    // Sanitize
    if(options.cssDir){
      result.push(options.cssDir.replace(/"/g, ''));
    }
    var resLength = result.length;
    for(var i = 0; i < resLength; i++){
      // a async delete does not delete the hidden .sass-cache dir
      fse.removeSync(path.join(srcDir, result[i]));
    }
    resolve();
  });
}

function CompassCompiler(inputTree, files, options) {
  if (arguments.length === 2 && files !== null && typeof files === 'object' && !(files instanceof Array)) {
    options = files;
    files = [];
  }

  if (!(this instanceof CompassCompiler)){
    return new CompassCompiler(inputTree, files, options);
  }
  this.inputTree = inputTree;
  this.files = [].concat(files || []);
  this.options = merge(true, this.defaultOptions);
  merge(this.options, options);
}

CompassCompiler.prototype = Object.create(Writer.prototype);
CompassCompiler.prototype.constructor = CompassCompiler;
CompassCompiler.prototype.updateCache = function (srcDir, destDir) {
  var self = this;
  var cmdLine;
  var options = merge(true, this.options);
  var cmd = [options.compassCommand, 'compile'];
  var cmdArgs = cmd.concat(this.files); //src is project dir or specified files
  var cssDir = path.join(destDir, options.cssDir || '');

  // make cssDir relative to destination where all files are copied to
  // when a css dir is given.
  // This should not really be necessary any longer since all is done in
  // the src dir, need to test it first.
  if(options.cssDir){
    cssDir = path.relative(destDir, cssDir);
    options.cssDir = '"'+ cssDir + '"';
  }
  cmdLine = cmdArgs.concat( dargs(options, ignoredOptions) ).join(' ');

  return compile(cmdLine, {cwd: srcDir})
  .then(function(){
    return copyRelevant(srcDir, destDir, self.options);
  })
  .then(function() {
    return cleanupSource(srcDir, options);
  })
  .then(function() {
    return destDir;
  }, function (err) {
    msg = err.message || err;
    console.log('[broccoli-compass] Error: ', msg + '\narguments: `' + cmdLine + '`');
    // do not swallow error, can not test on failing execution.
    throw err;
  });
};

// Options are overwritten once used. This has to be merged on final options.
CompassCompiler.prototype.defaultOptions = {
  relativeAssets: true,
  // this was overwriting compass which defaults to sass, which is rather confusing.
  sassDir: 'sass',
  compassCommand: 'compass'
};

module.exports = CompassCompiler;