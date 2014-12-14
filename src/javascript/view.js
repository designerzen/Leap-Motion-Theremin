var View = (function(window){
	"use strict";
	var 
		sphere,
		cube,
		dataArray,
		bufferLength,
		particles = [],
		analyser;
	/*	
	this.scene;
	this.camera;
	this.world;
	this.renderer;
	this.pointLight;
	*/
	var group;
	 var colour = 0x222222;
	
	// pass in the dom elements
	function View( element, audioAnalyser )
	{
		var self = this;
		
		analyser = audioAnalyser;

		analyser.fftSize = 2048;
    	bufferLength = analyser.fftSize;
		// analyser.fftSize = 256;
		// bufferLength = analyser.frequencyBinCount;
		dataArray = new Uint8Array(bufferLength);

		this.midWidth = window.innerWidth / 2;
		this.midHeight = window.innerHeight/2;
		
		// five vertical bars, each one represents one channel...
		
		this.scene = new THREE.Scene();
		this.scene.fog = new THREE.FogExp2( colour, 0.0008 );
		
		this.renderer = new THREE.WebGLRenderer({
			alpha: false
		});
		var normalMaterial = new THREE.MeshNormalMaterial();
		// Sphere
		// the first argument of THREE.SphereGeometry is the radius, the second argument is
		// the segmentsWidth, and the third argument is the segmentsHeight.  Increasing the 
		// segmentsWidth and segmentsHeight will yield a more perfect circle, but will degrade
		// rendering performance
		sphere = new THREE.Mesh(new THREE.SphereGeometry(15, 10, 10), normalMaterial);
		sphere.position.x = -10;
		sphere.overdraw = true;
		this.scene.add( sphere );
		
		
		cube = new THREE.Mesh(new THREE.BoxGeometry(20, 40, 40 ), normalMaterial);
		cube.position.x = 10;
		this.scene.add( cube );
		
		var generateTexture = function () {

			var canvas = document.createElement( 'canvas' );
			canvas.width = window.innerWidth;
			canvas.height =  window.innerHeight;

			var context = canvas.getContext( '2d' );
			context.beginPath();
			context.arc( 0, 0, 0.5, 0, Math.PI*2, true );
			context.fill();
			return canvas;

		}
		var texture = new THREE.Texture( generateTexture() );
		texture.needsUpdate = true; // important!
		
		//group = new THREE.Group();
		var program = function ( context ) {

			context.beginPath();
			context.arc( 0, 0, 0.5, 0, PI2, true );
			context.fill();

		};
		
		//var material = new THREE.SpriteMaterial( { map: texture } );
		
		group = new THREE.Object3D();
		

		var geometry = new THREE.Geometry();
		for ( var j = 0; j < bufferLength; j ++ ) {

			var vertex = new THREE.Vector3();
			vertex.x = Math.random() * 2000 - 1000;
			vertex.y = Math.random() * 2000 - 1000;
			vertex.z = Math.random() * 2000 - 1000;

			geometry.vertices.push( vertex );
		}
		
		for ( var i = 0; i < 2; i ++ ) {

				//color  = parameters[i][0];
				//sprite = parameters[i][1];
				//size   = parameters[i][2];
				var pointSize = 10;
				var material = new THREE.PointCloudMaterial( { size: pointSize, vertexColors: THREE.VertexColors, blending: THREE.AdditiveBlending, depthTest: false }  );
				//var material = new THREE.PointCloudMaterial( { size: 30, map: texture, blending: THREE.AdditiveBlending, depthTest: false, transparent : true } );
				material.color.setHSL( 0xffffff, 0xffffff, Math.random()*0xffffff );

				var pointCloud = new THREE.PointCloud( geometry, material );

				pointCloud.rotation.x = Math.random() * 6;
				pointCloud.rotation.y = Math.random() * 6;
				pointCloud.rotation.z = Math.random() * 6;
			
				pointCloud.scale.x = (1+i) * 0.3;
				pointCloud.scale.y = (1+i) * 0.3;
				pointCloud.scale.z = (1+i) * 0.3;
			
			
				particles.push(pointCloud);
				group.add( pointCloud );

		}
		this.scene.add( group );
		
		/*
		for ( var i = 0; i < 10; i++ ) {
			
			
			var material = new THREE.SpriteCanvasMaterial( {
				color: Math.random() * 0x808008 + 0x808080,
				program: program
			} );

			//var particle = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 10), normalMaterial);
			//var particle = new THREE.Mesh(new THREE.SphereGeometry(10, 10, 10), material);
			var particle = new THREE.Sprite( material );
			particle.position.x = Math.random() * 50 - 100;
			particle.position.y = Math.random() * 50 - 100;
			particle.position.z = Math.random() * 50 - 100;
			//particle.scale.x = particle.scale.y = Math.random() * 6 + 5;
			//group.add( new THREE.SphereGeometry(15, 15, 15), material );
			group.add( particle );
			console.log( particle );
		}
		*/
		this.renderer.setClearColor(colour, 1);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.domElement.style.position = 'fixed';
		this.renderer.domElement.style.top = 0;
		this.renderer.domElement.style.left = 0;
		this.renderer.domElement.style.width = '100%';
		this.renderer.domElement.style.height = '100%';
		
		this.pointLight = new THREE.PointLight(0x9999ff);
		//this.pointLight.position = new THREE.Vector3(-20, 10, 0);
		this.pointLight.lookAt(new THREE.Vector3(0, 0, 0));
		
		//this.scene.add(new THREE.AxisHelper(40));
		this.scene.add(new THREE.AmbientLight(0x886666));
		this.scene.add( this.pointLight );
		
		this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
		this.camera.position.fromArray([0, 160, 100]);
		this.camera.lookAt(new THREE.Vector3(0, 0, 0));

		this.controls = new THREE.TrackballControls(this.camera);
		
		this.scene.add( this.camera );
		
		// postprocessing
		var renderModel = new THREE.RenderPass( this.scene, this.camera );
		//var effectBloom = new THREE.BloomPass( 0.0000000075 );
		// noiseIntensity, scanlinesIntensity, scanlinesCount, grayscale
		var effectFilm = new THREE.FilmPass( 0.8, 0.7, 1448, false );
		var effectFocus = new THREE.ShaderPass( THREE.FocusShader );
		effectFocus.uniforms[ "screenWidth" ].value = window.innerWidth;
		effectFocus.uniforms[ "screenHeight" ].value = window.innerHeight;
		effectFocus.renderToScreen = true;
		
		this.composer = new THREE.EffectComposer( this.renderer );
		this.composer.addPass( renderModel );
		//this.composer.addPass( effectBloom );
		this.composer.addPass( effectFilm );
		this.composer.addPass( effectFocus );

		element.appendChild( this.renderer.domElement);
		
		
		window.addEventListener('resize', function() {
			self.camera.aspect = window.innerWidth / window.innerHeight;
			self.camera.updateProjectionMatrix();
			self.renderer.setSize(window.innerWidth, window.innerHeight);
			self.controls.handleResize();
				self.composer.reset();
				effectFocus.uniforms[ "screenWidth" ].value = window.innerWidth;
				effectFocus.uniforms[ "screenHeight" ].value = window.innerHeight;


			return self.renderer.render(self.scene, self.camera);
		}, false);


		return this.renderer.render(this.scene, this.camera);
	}
	
	View.prototype.setFrequency = function( freq )
	{
		//cube.scale.x = freq / 5;
		cube.scale.y = freq;
		//cube.scale.z = freq / 5;
	};

	View.prototype.setGain = function( gain )
	{
		if (gain > 0) group.scale.x = group.scale.y = group.scale.z = gain;
	};
	
	View.prototype.setDistortion = function( value )
	{
		if (value > 0) group.scale.x = group.scale.y = group.scale.z = value;
	};
	
	View.prototype.getProximityX = function( screenPositionX ){
		var proximity = 0;
		if ( screenPositionX < this.midWidth ) proximity = 1-(screenPositionX / this.midWidth);
		else if ( screenPositionX > this.midWidth ) proximity = (screenPositionX-this.midWidth)/this.midWidth;
		return proximity > 1 ? 1 : proximity < 0 ? 0 : proximity;
	};
	
	View.prototype.getProximityY = function( screenPositionY ){
		var proximity = 0;
		if ( screenPositionY < this.midHeight ) proximity = (screenPositionY / this.midHeight);
		else if ( screenPositionY > this.midHeight ) proximity =  1-((screenPositionY-this.midHeight)/this.midHeight);
		return proximity > 1 ? 1 : proximity < 0 ? 0 : proximity;
	};
	
	View.prototype.update = function(){
		analyser.getByteTimeDomainData(dataArray);
		//analyser.getByteFrequencyData(dataArray);
			
		for ( var p=0, l=particles.length; p < l; ++p)
		{
			var pointCloud = particles[p];
			var geom = pointCloud.geometry;
			pointCloud.rotation.y -= (p+1) * 0.0001;
		
			for(var i = 0; i < bufferLength; ++i) 
			{
				var data = dataArray[i];


			 }
		}
		
		sphere.rotation.y += 0.001;
		cube.rotation.y -= 0.001;
		
		this.renderer.clear();
		this.composer.render( 0.01 );

		//this.renderer.render( this.scene, this.camera);
	}
	/*
function visualize() {
  var visualSetting = "sinewave";
  
  if(visualSetting == "sinewave") {
    
   // loop
      
      var sliceWidth = WIDTH * 1.0 / bufferLength;
      var x = 0;

      for(var i = 0; i < bufferLength; i++) {
   
        var v = dataArray[i] / 128.0;
        var y = v * HEIGHT/2;

        if(i === 0) {
          
        } else {
          
        }

        x += sliceWidth;
      }



  } else if(visualSetting == "frequencybars") {
    analyser.fftSize = 256;
    var bufferLength = analyser.frequencyBinCount;
    console.log(bufferLength);
    var dataArray = new Uint8Array(bufferLength);

    canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

    function draw() {
      drawVisual = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = 'rgb(0, 0, 0)';
      canvasCtx.fillRect(0, 0, WIDTH, HEIGHT);

      var barWidth = (WIDTH / bufferLength) * 2.5;
      var barHeight;
      var x = 0;

      for(var i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i];

        canvasCtx.fillStyle = 'rgb(' + (barHeight+100) + ',50,50)';
        canvasCtx.fillRect(x,HEIGHT-barHeight/2,barWidth,barHeight/2);

        x += barWidth + 1;
      }
    };

    draw();

  } 

}
*/
	return View;
	
})(window);