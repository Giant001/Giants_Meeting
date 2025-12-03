import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  analyzerNode?: AnalyserNode; // If we had a real analyzer
  audioLevel: number; // Simulated or computed level 0-100
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, audioLevel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let phase = 0;

    const render = () => {
      // Clear
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = 50;
      
      // Dynamic radius based on audio level
      // Smooth the level a bit would be nice, but raw is okay for now
      const radius = baseRadius + (audioLevel * 50);

      // Draw glowing orb
      const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.5, centerX, centerY, radius);
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0.9)'); // Blue 500
      gradient.addColorStop(0.5, 'rgba(59, 130, 246, 0.4)');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw "Speaking" ripples if active
      if (isActive && audioLevel > 0.1) {
        ctx.strokeStyle = `rgba(147, 197, 253, ${0.8 - (phase % 1)})`; // Blue 300 fade
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius + (phase * 20), 0, Math.PI * 2);
        ctx.stroke();

        phase += 0.05;
        if (phase > 3) phase = 0;
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [isActive, audioLevel]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={300} 
      className="w-full h-full object-contain"
    />
  );
};

export default AudioVisualizer;