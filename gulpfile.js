/*

This is just a handy Gulp Boilerplate that
handles the compilation of the source elements

Less 	-> 	CSS 3
Jade 	-> 	xHTML


*/

// =======================---------------- IMPORT DEPENDENCIES --------------------

// Requirements for this build to work :
var gulp = require('gulp');						// main Gulp
var concat = require('gulp-concat');			// combine files
var minify = require('gulp-minify');			// squash files
var newer = require('gulp-newer');				// deal with only modified files
var del = require('del');						// delete things and folders
var sequencer = require('run-sequence');
var connect = require('gulp-connect');

// =======================---------------- CONFIGURATION --------------------

// Set up paths here!
var SOURCE_FOLDER 			= 'src/';		// Source files Root
var BUILD_FOLDER 			= 'build/';		// Where the initial build occurs (debugable)
var DISTRIBUTION_FOLDER 	= 'dist/';		// Once debugging is complete, copy to server ready files here

// Where do our source files live?
var source = {
	styles 	: SOURCE_FOLDER+'less/style.less',
	scripts : [ 
		/*SOURCE_FOLDER+'javascript/vendor/three.js',  
		SOURCE_FOLDER+'javascript/vendor/three.*.js',  
		SOURCE_FOLDER+'javascript/vendor/leap-*.js', 
		SOURCE_FOLDER+'javascript/vendor/leap.*.js', 
		SOURCE_FOLDER+'javascript/vendor/*rigged*.js', 
		//SOURCE_FOLDER+'javascript/vendor/*.js', */
		SOURCE_FOLDER+'javascript/vendor/geometries/*.js',
		SOURCE_FOLDER+'javascript/vendor/shaders/*.js',
		SOURCE_FOLDER+'javascript/vendor/postprocessing/*.js',
		//SOURCE_FOLDER+'javascript/vendor/renderers/*.js',
		SOURCE_FOLDER+'javascript/view.js',
		SOURCE_FOLDER+'javascript/theremin.js',
		SOURCE_FOLDER+'javascript/main.js'
	],
	jade 	: SOURCE_FOLDER+'jade/*.jade',
	images	: SOURCE_FOLDER+'images/**/*',
	models	: SOURCE_FOLDER+'models/**/*.lz'
};

// Where shall we compile them to?
var destination = {
	styles 	: BUILD_FOLDER+'css',
	scripts : BUILD_FOLDER+'js',
	html 	: BUILD_FOLDER,
	images	: BUILD_FOLDER+'img'
};

var imageCrunchOptions = {
	optimizationLevel: 3,
	progressive: false
};

var htmlSquishOptions = {
	removeComments     : true,
	collapseWhitespace : true,
	minifyCSS          : true,
	keepClosingSlash   : true
};

// =======================---------------- TASK DEFINITIONS --------------------

gulp.task('clean', function(cb) {
	// You can use multiple globbing patterns as you would with `gulp.src`
	del([BUILD_FOLDER,DISTRIBUTION_FOLDER], cb);
});


// Jade ==========================================================
gulp.task('jade', function() {
	var jade = require('gulp-jade');
	var htmlmin = require('gulp-htmlmin');
	// Minify and copy all JavaScript (except vendor scripts)
	// with sourcemaps all the way down
	return 	gulp.src( source.jade )
			.pipe( jade( { pretty:true, debug:false, compileDebug:false } ) )
			.pipe( gulp.dest( destination.html ) );//.pipe(connect.reload());
});

// Image Tasks ===================================================

// Copy all static images & squish
gulp.task('images', function() {
	var imagemin = require('gulp-imagemin');		// squish images
	return 	gulp.src( source.images)
			.pipe( newer(destination.images) )
			// Pass in options to the task
			.pipe( imagemin( imageCrunchOptions ) )
			.pipe( gulp.dest( destination.images ) );//.pipe(connect.reload());
});



// Cascading Style Sheets ========================================

gulp.task('css', function() {
	// CSS Plugins
	var less = require('gulp-less');				// compile less files to css
	return 	gulp.src( source.styles )
			.pipe( newer( destination.styles ) )
			// compile less
			.pipe( less( {strictMath: false, compress: true }) )
			// lint
			// squish
			//.pipe( minify() )
			.pipe( gulp.dest( destination.styles ) );//.pipe(connect.reload());
});

gulp.task('models', function() {
	return 	gulp.src( source.models )
			.pipe( newer( destination.html ) )
			.pipe( gulp.dest( destination.html ) );//.pipe(connect.reload());
});

// Javascripts ===================================================

// Do stuff with our javascripts for DEBUGGING
gulp.task('scripts-vendor', function() {
	return  gulp.src( SOURCE_FOLDER+'javascript/vendor/*.js' )
            .pipe( gulp.dest( destination.scripts+'/vendor/' ) )
});
	
gulp.task('scripts', function() {
    // Minify and copy all JavaScript (except vendor scripts)
    // with sourcemaps all the way down
	var uglify = require('gulp-uglify');            // squash files
	var jshint = require('gulp-jshint');			// lint!
	var sourcemaps = require('gulp-sourcemaps');    // create source maps for debugging!

	return  gulp.src( source.scripts )
            .pipe( sourcemaps.init() )
            // combine multiple files into one!
            .pipe( concat('main.min.js') )
			//.pipe( jshint('.jshintrc'))
			//.pipe( jshint.reporter('default') )
			// create source maps
            .pipe( sourcemaps.write() )
            .pipe( gulp.dest( destination.scripts ) );//.pipe(connect.reload());
});


// Utilities =====================================================

gulp.task('webserver', function() {
	connect.server({
		root: 'build',
		livereload: true
	});
});
// Rerun the task when a file changes
gulp.task('watch', function() {

  // Create LiveReload server
  //livereload.listen();
    
  // Watch any files in dist/, reload on change
  gulp.watch([source.jade], ['jade']);
  gulp.watch([source.scripts], ['scripts']);
  gulp.watch([source.styles], ['css']);
  //gulp.watch(['src/**/**'], ['build']);//.on('change', livereload.changed);

});
// =======================---------------- TASKS --------------------

/*

// Assembly

1. Compile css from less 
2. Squish css

3. Compile Jade templates
4. Inject css into header
5. Inline css into page elements
6. Compress html 

7. Minify Images

*/


// compile all assets & create sourcemaps
gulp.task('build', 		[ 'css', 'models', 'jade', 'images','scripts-vendor', 'scripts' ] );

// squish everything & concatanate scripts
gulp.task('deploy', 	[ 'build' ] );

// create a server to host this project
gulp.task('serve', 		['build','webserver', 'watch'] );


// The default task (called when you run `gulp` from cli)
// As many of these tasks are not asynch
gulp.task('default', function(callback) {
	sequencer(
		'clean',
		'build',
    callback);
});