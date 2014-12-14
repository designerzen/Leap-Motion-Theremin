var Theremin = (function(){
	"use strict";

	// create web audio api context
	var Patch = window.AudioContext || window.webkitAudioContext;

	var SMALLEST = 0.00001;
	var maxVol = 0.5;

	var initialFreq = 10;//250;
	var frequencyRange = 150;//6000;
	var initialVol = 0.2;

	var muted = false;
	
	function dub(node, context){
		
		var dubDelay = context.createDelay();
		dubDelay.delayTime.value = 0.7;
		node.connect(dubDelay);
		
		var feedback = context.createGain();
		feedback.gain.value = 0.5;

		var filter = context.createBiquadFilter();
		filter.frequency.value = 1000;

		dubDelay.connect(feedback);
		feedback.connect(filter);
		filter.connect(dubDelay);
		dubDelay.connect(context.destination);
	}
	
	function makeDistortionCurve(amount) {
		var k = typeof amount === 'number' ? amount : 50,
			n_samples = 44100,
			curve = new Float32Array(n_samples),
			deg = Math.PI / 180,
			i = 0,
			x;
		for ( ; i < n_samples; ++i ) {
			x = i * 2 / n_samples - 1;
			curve[i] = ( 3 + k ) * x * 20 * deg / ( Math.PI + k * Math.abs(x) );
		}
		return curve;
	};
	
	function Theremin( audioContext, dubMode )
	{
    	var audioCtx = audioContext || new Patch();
		
		this.isPlaying = false;
		this.isStopped = true;

		this.audioContext = audioCtx;
		
		// create Oscillator and gain node
		this.gainNode 		= audioCtx.createGain();
		this.biquadFilter	= audioCtx.createBiquadFilter();
		this.convolver 		= audioCtx.createConvolver();
		this.analyser 		= audioCtx.createAnalyser();
		this.distortion = audioCtx.createWaveShaper();
		this.delay = audioCtx.createDelay();
		this.analyser = audioCtx.createAnalyser();
		
		// connect oscillator to gain node to speakers
		//oscillator.connect(gainNode);
		// create initial theremin frequency and volumn values
		this.oscillator = audioCtx.createOscillator();
		this.oscillator.type = 'sine';
		this.oscillator.frequency.value = initialFreq; // value in hertz
		this.oscillator.detune.value = 100; // value in cents
		this.oscillator.onended = function() {
		  console.log('Your tone has now stopped playing!');
		};
		this.oscillator.connect(this.delay);
		
		this.delay.delayTime.value = 0.1;
		this.delay.connect(this.analyser);
		
		this.analyser.minDecibels = -90;
		this.analyser.maxDecibels = -10;
		this.analyser.smoothingTimeConstant = 0.85
		this.analyser.connect(this.distortion);
		
		this.distortion.oversample = '4x';//distortion.connect(convolver);
		this.distortion.curve = makeDistortionCurve(0);
		this.distortion.connect(this.gainNode);
		//biquadFilter.connect(this.gainNode);
		//convolver.connect(this.gainNode);
		
		this.gainNode.gain.value = initialVol;
		
		this.gainNode.connect(audioCtx.destination);
		if (dubMode) dub(this.gainNode, audioCtx);
		
		return;
		// effects
		this.distortion.curve = new Float32Array;
		
		this.biquadFilter.gain.value = 0;
		this.convolver.buffer = undefined;
		//if(voiceSetting == "distortion") {
			this.distortion.curve = makeDistortionCurve(400);
		//} else if(voiceSetting == "convolver") {
			//convolver.buffer = concertHallBuffer;
		//} else if(voiceSetting == "biquad") {
			this.biquadFilter.type = "lowshelf";
			this.biquadFilter.frequency.value = 1000;
			this.biquadFilter.gain.value = 25;
		//} 
	}
	
	Theremin.prototype.getAudioContext = function()
	{
		return this.audioContext;	
	}
	Theremin.prototype.getAnalyser = function()
	{
		return this.analyser;	
	}
	Theremin.prototype.toggleMute = function()
	{
		if( !muted ) 
		{
			this.gainNode.disconnect(this.audioContext.destination);
			muted = true;
		} else {
			this.gainNode.connect(this.audioContext.destination);
		  	muted = false;
		};
		return muted;
	};
	
	Theremin.prototype.stop = function()
	{
		
		if (this.isStopped) return;
		console.error('stop');
		//gainNode.disconnect(audioCtx.destination);
		this.oscillator.disconnect(this.delay);
		this.gainNode.gain.value = SMALLEST;
		//oscillator.stop();
		this.isStopped = true;
	};
	
	Theremin.prototype.start = function()
	{
		
		if (this.isStopped)
		{
			this.gainNode.gain.value = initialVol;
			this.oscillator.connect(this.delay);
			this.isStopped = false;
			console.error('start');
		}
		if (this.isPlaying) return;
		this.isPlaying = true;
		this.oscillator.start();
	};
	
	Theremin.prototype.setDistortion = function( value )
	{
		this.distortion.curve = makeDistortionCurve(value);
	};
	
	Theremin.prototype.setType = function( value )
	{
		this.oscillator.type = value;
	};
	Theremin.prototype.setFrequencyPercent = function( freq )
	{
		var converted = initialFreq + freq* frequencyRange;
		this.setFrequency(converted);
		//console.log( converted , gainNode.gain.value );
	};
	Theremin.prototype.setFrequency = function( freq )
	{
		this.oscillator.frequency.value = freq;
	};

	Theremin.prototype.setGainPercent = function( gain )
	{
		var converted = gain;
		this.setGain( converted );
	};
	Theremin.prototype.setGain = function( gain )
	{
		if (gain <= 0) gain = SMALLEST;
		initialVol = gain;
		this.gainNode.gain.value = gain;
		//console.log( gain );
	};
	
	return Theremin;
	
})();


 // rC = Math.floor((gainNode.gain.value/maxVol)*30);

 // oscillator.frequency.value = (KeyX/WIDTH) * maxFreq;
  //gainNode.gain.value = (KeyY/HEIGHT) * maxVol;

