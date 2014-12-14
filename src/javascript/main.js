var theremin = new Theremin( );
var thereminLeft = new Theremin( theremin.getAudioContext(), true );
var content = document.getElementById('content');
var visualiser = document.getElementById('visualiser');
var view = new View( visualiser, theremin.getAnalyser() );
var hands = 0;
var riggedHandPlugin;
var userEngaged = false;

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
		var deviationX , deviationY, deviationZ;
		// now determine hand
		switch(type)
		{
			case "right":
				deviationX = view.getProximityX( screenPosition.x );
				view.setFrequencyRight( deviationX );
				//theremin.setFrequency( deviationX );
				theremin.setFrequencyPercent( deviationX );
				theremin.setDistortion( fist * 400 );
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
				//deviationY = view.getProximityY( screenPosition.y );
				deviationZ = 1 - ( (hand.palmPosition[1]-60)/ 300);
				view.setGain( deviationZ );
				//theremin.setGain( deviationY );
				//
				
				theremin.setGainPercent( deviationZ );
				view.setDistortion( fist  );
				if (userEngaged) theremin.start();
				break;
				
			case "left":
				
				deviationX = view.getProximityX( screenPosition.x );
				view.setFrequencyLeft( deviationX );
				//theremin.setFrequency( deviationX );
				thereminLeft.setFrequencyPercent( deviationX );
				thereminLeft.setDistortion( fist * 400 );
				if (rotation < -1)
				{
					thereminLeft.setType('sine');
					//console.error( 'square', rotation );

				} else if (rotation > 0) {
					thereminLeft.setType('saw');
					//console.error( 'saw', rotation );

				}else{
					theremin.setType('square');
					//console.error( 'sine', rotation );
				}
				
				//deviationY = view.getProximityY( screenPosition.y );
				//deviationZ = 1 - ( (hand.palmPosition[1]-60)/ 300);
				//view.setGainLeft( deviationZ );
				//
				//thereminLeft.setGainPercent( deviationZ );
				thereminLeft.setGainPercent( 1 );
				view.setDistortion( fist );
				if (userEngaged) 
				{
					thereminLeft.start();
					
				}
				break;
		}
	}
	
})
.use('riggedHand',
{
	parent: view.scene,
	renderer: view.renderer,
	camera: view.camera,
	scale: getParam('scale') || 0.3,
	positionScale: getParam('positionScale') || 0.4,
	offset: new THREE.Vector3(0, -70, -90),
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
			//theremin.start();
			break;
		case "left":
			//thereminLeft.start();
			break;
	}
	//console.error(hand.type+' focus '+hands);
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
	//console.error(hand.type+' unfocus '+hands);
})
.use('playback', {
	recording: './left-or-right-77fps.json.lz',
	timeBetweenLoops: 1000
})
 .on('frame', function (frame) {
    if (frame.hands.length == 0)
	{
		userEngaged = false;
		theremin.stop();
		thereminLeft.stop();
	} else{
		userEngaged = true;
	}
});

riggedHandPlugin = Leap.loopController.plugins.riggedHand;
content.className = 'active';