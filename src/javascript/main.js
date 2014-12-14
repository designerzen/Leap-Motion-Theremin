var theremin = new Theremin();
var thereminLeft = new Theremin( theremin.getAudioContext() );

var view = new View( document.body, theremin.getAnalyser() );
var hands = 0;
var riggedHandPlugin;

function getParam(name) {
	name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
	var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
	results = regex.exec(location.search);
	return results == null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
};

Leap.loop({
	
  	hand: function(hand){
		var type = hand.type;
		
		var handMesh = hand.data('riggedHand.mesh');
		var screenPosition = handMesh.screenPosition(
		  	//hand.fingers[1].tipPosition,
			hand.palmPosition,
		  	riggedHandPlugin.camera
		);

		// between -3.6 and +3.6
		var rotation =  hand.roll();
		var fist = hand.grabStrength;
		// now determine hand
		switch(type)
		{
			case "right":
				var deviationX = view.getProximityX( screenPosition.x );
				view.setFrequency( deviationX );
				//theremin.setFrequency( deviationX );
				theremin.setFrequencyPercent( deviationX );
				theremin.setDistortion( fist * 400 );
				view.setDistortion( fist * 400 );
				if (rotation < -1)
				{
					theremin.setType('square');
					//console.error( 'square', rotation );

				} else if (rotation > 0) {
					theremin.setType('saw');
					//console.error( 'saw', rotation );

				}else{
					theremin.setType('sine');
					//console.error( 'sine', rotation );
				}
				//var deviationY = view.getProximityY( screenPosition.y );
				var deviationZ = 1 - ( (hand.palmPosition[1]-60)/ 300);
				//view.setGain( deviationY );
				//theremin.setGain( deviationY );
				theremin.setGainPercent( deviationZ );
			
				break;
				
			case "left":
				
				var deviationX = view.getProximityX( screenPosition.x );
				view.setFrequency( deviationX );
				//theremin.setFrequency( deviationX );
				thereminLeft.setFrequencyPercent( deviationX );
				thereminLeft.setDistortion( fist * 400 );
				if (rotation < -1)
				{
					thereminLeft.setType('square');
					//console.error( 'square', rotation );

				} else if (rotation > 0) {
					thereminLeft.setType('saw');
					//console.error( 'saw', rotation );

				}else{
					theremin.setType('sine');
					//console.error( 'sine', rotation );
				}//var deviationY = view.getProximityY( screenPosition.y );
				var deviationZ = 1 - ( (hand.palmPosition[1]-60)/ 300);
				//view.setGain( deviationY );
				//theremin.setGain( deviationY );
				thereminLeft.setGainPercent( deviationZ );
				view.setDistortion( fist * 400 );
				console.error( deviationZ,type );
				//console.error( type );

				break;
		}
	}
	
})
.use('riggedHand',
{
	parent: view.scene,
	renderer: view.renderer,
	camera: view.camera,
	scale: getParam('scale') || 1,
	positionScale: getParam('positionScale') || 1,
	offset: new THREE.Vector3(0, -10, -20),
	boneColors: function (boneMesh, leapHand){
		  if ((boneMesh.name.indexOf('Finger_') == 0) ) {
			return {
			  hue: 0.564,
			  saturation: leapHand.grabStrength,
			  lightness: 0.5
			}
		  }
	},
	renderFn: function() {
		return view.update();
	}
})
.use('handEntry')
.on('handFound', function(hand){
	hands++;
	switch(hand.type)
	{
		case "right":
			theremin.start();
			break;
		case "left":
			thereminLeft.start();
			break;
	}
	console.error('focus '+hands);
})
.on('handLost', function(hand){
	hands--;
	
	switch(hand.type)
	{
		case "right":
			theremin.stop();
			break;
		case "left":
			thereminLeft.stop();
			break;
	}
	console.error('unfocus '+hands);
})
.use('playback', {
	recording: './left-or-right-77fps.json.lz',
	timeBetweenLoops: 1000
});

riggedHandPlugin = Leap.loopController.plugins.riggedHand;