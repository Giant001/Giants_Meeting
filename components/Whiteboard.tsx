import React, { useRef, useEffect, useState } from 'react';
import { PenIcon, EraserIcon, TrashIcon } from './Icons';

interface WhiteboardProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

const Whiteboard: React.FC<WhiteboardProps> = ({ canvasRef }) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#ffffff');
  const [isEraser, setIsEraser] = useState(false);
  const [lineWidth, setLineWidth] = useState(3);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set high resolution
    const resizeCanvas = () => {
       if (containerRef.current) {
         const { width, height } = containerRef.current.getBoundingClientRect();
         canvas.width = width * 2; // Retina support
         canvas.height = height * 2;
         canvas.style.width = `${width}px`;
         canvas.style.height = `${height}px`;
         
         const context = canvas.getContext('2d');
         if (context) {
            context.scale(2, 2);
            context.lineCap = 'round';
            context.lineJoin = 'round';
            context.strokeStyle = color;
            context.lineWidth = lineWidth;
            contextRef.current = context;
         }
       }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Fill black background initially
    const ctx = canvas.getContext('2d');
    if(ctx) {
        ctx.fillStyle = "#111827"; // gray-900
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  useEffect(() => {
    if (contextRef.current) {
        contextRef.current.strokeStyle = isEraser ? '#111827' : color;
        contextRef.current.lineWidth = isEraser ? 20 : lineWidth;
    }
  }, [color, isEraser, lineWidth]);

  const startDrawing = ({ nativeEvent }: React.MouseEvent) => {
    const { offsetX, offsetY } = nativeEvent;
    if (contextRef.current) {
        contextRef.current.beginPath();
        contextRef.current.moveTo(offsetX, offsetY);
        setIsDrawing(true);
    }
  };

  const finishDrawing = () => {
    if (contextRef.current) {
        contextRef.current.closePath();
    }
    setIsDrawing(false);
  };

  const draw = ({ nativeEvent }: React.MouseEvent) => {
    if (!isDrawing || !contextRef.current) return;
    const { offsetX, offsetY } = nativeEvent;
    contextRef.current.lineTo(offsetX, offsetY);
    contextRef.current.stroke();
  };

  const clearBoard = () => {
    const canvas = canvasRef.current;
    if (canvas && contextRef.current) {
        contextRef.current.fillStyle = "#111827";
        contextRef.current.fillRect(0, 0, canvas.width / 2, canvas.height / 2); // Divide by 2 because of scale
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-gray-900 rounded-2xl overflow-hidden border border-gray-700 cursor-crosshair">
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseUp={finishDrawing}
        onMouseMove={draw}
        onMouseLeave={finishDrawing}
        className="block"
      />
      
      {/* Toolbar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-full px-4 py-2 flex items-center gap-4 shadow-xl z-10">
        {/* Colors */}
        {!isEraser && (
            <div className="flex gap-2 mr-2 border-r border-gray-600 pr-4">
                {['#ffffff', '#ef4444', '#3b82f6', '#22c55e', '#eab308'].map((c) => (
                    <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                    />
                ))}
            </div>
        )}

        <button 
            onClick={() => setIsEraser(false)}
            className={`p-2 rounded-full ${!isEraser ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
            <PenIcon className="w-5 h-5" />
        </button>

        <button 
            onClick={() => setIsEraser(true)}
            className={`p-2 rounded-full ${isEraser ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
            <EraserIcon className="w-5 h-5" />
        </button>
        
        <div className="w-px h-6 bg-gray-600 mx-1"></div>

        <button 
            onClick={clearBoard}
            className="p-2 rounded-full text-red-400 hover:text-red-300 hover:bg-red-900/30"
            title="Clear Board"
        >
            <TrashIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default Whiteboard;