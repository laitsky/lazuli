'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Camera, LineChart, Volume2, VolumeX } from 'lucide-react';

/**
 * Props for the ChartControlsToolbar component
 */
interface ChartControlsToolbarProps {
  /** Whether logarithmic scale is enabled */
  isLogScale: boolean;
  /** Callback when log scale is toggled */
  onLogScaleChange: (isLog: boolean) => void;
  /** Whether volume is visible */
  showVolume: boolean;
  /** Callback when volume visibility is toggled */
  onVolumeChange: (show: boolean) => void;
  /** Callback to take a screenshot */
  onScreenshot: () => void;
  /** Whether a screenshot is being taken */
  isCapturing?: boolean;
  /** Optional additional className */
  className?: string;
}

/**
 * Floating toolbar component for chart controls
 * Provides toggles for:
 * - Logarithmic vs Linear scale
 * - Show/Hide volume
 * - Screenshot current chart view
 *
 * Designed to overlay on top of a chart component
 */
export function ChartControlsToolbar({
  isLogScale,
  onLogScaleChange,
  showVolume,
  onVolumeChange,
  onScreenshot,
  isCapturing = false,
  className,
}: ChartControlsToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Chart controls"
      className={cn(
        // Floating toolbar styling
        'absolute top-3 right-3 z-10',
        'flex items-center gap-1.5 p-1.5',
        // Glass morphism effect
        'bg-background/80 backdrop-blur-md',
        'border border-white/10 rounded-lg',
        // Subtle shadow for depth
        'shadow-lg shadow-black/20',
        // Transition for smooth appearance
        'transition-all duration-200',
        className
      )}
    >
      {/* Log/Linear Scale Toggle */}
      <ToolbarButton
        icon={<LineChart className="h-4 w-4" />}
        label={isLogScale ? 'Log' : 'Linear'}
        isActive={isLogScale}
        onClick={() => onLogScaleChange(!isLogScale)}
        tooltip={isLogScale ? 'Switch to Linear Scale' : 'Switch to Log Scale'}
      />

      {/* Volume Toggle */}
      <ToolbarButton
        icon={showVolume ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        label="Vol"
        isActive={showVolume}
        onClick={() => onVolumeChange(!showVolume)}
        tooltip={showVolume ? 'Hide Volume' : 'Show Volume'}
      />

      {/* Separator */}
      <div role="separator" aria-orientation="vertical" className="h-5 w-px bg-white/10 mx-0.5" />

      {/* Screenshot Button */}
      <ToolbarButton
        icon={<Camera className="h-4 w-4" />}
        onClick={onScreenshot}
        disabled={isCapturing}
        tooltip="Take Screenshot"
        isLoading={isCapturing}
      />
    </div>
  );
}

/**
 * Props for individual toolbar buttons
 */
interface ToolbarButtonProps {
  icon: React.ReactNode;
  label?: string;
  isActive?: boolean;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  isLoading?: boolean;
}

/**
 * Individual toolbar button with icon and optional label
 * Supports active state styling and loading state
 */
function ToolbarButton({
  icon,
  label,
  isActive = false,
  onClick,
  disabled = false,
  tooltip,
  isLoading = false,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={isActive}
      className={cn(
        // Base button styling
        'flex items-center gap-1.5 px-2 py-1.5 rounded-md',
        'text-xs font-medium',
        'transition-all duration-150',
        'cursor-pointer select-none',
        // Focus styles
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        // Disabled state
        'disabled:opacity-50 disabled:cursor-not-allowed',
        // Active vs inactive styling
        isActive
          ? 'bg-primary/20 text-primary border border-primary/30'
          : 'text-muted-foreground hover:text-foreground hover:bg-white/5',
        // Loading animation
        isLoading && 'animate-pulse'
      )}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

/**
 * Return type for the useChartControls hook
 */
interface ChartControlsState {
  isLogScale: boolean;
  setIsLogScale: (value: boolean) => void;
  showVolume: boolean;
  setShowVolume: (value: boolean) => void;
  isCapturing: boolean;
  captureScreenshot: (element: HTMLElement | null, filename?: string) => Promise<void>;
}

/**
 * Hook to manage chart control state
 * Provides state management for log scale, volume visibility, and screenshot functionality
 *
 * @param initialLogScale - Initial state for logarithmic scale (default: false)
 * @param initialShowVolume - Initial state for volume visibility (default: true)
 * @returns Chart controls state and actions
 */
export function useChartControls(
  initialLogScale = false,
  initialShowVolume = true
): ChartControlsState {
  const [isLogScale, setIsLogScale] = useState(initialLogScale);
  const [showVolume, setShowVolume] = useState(initialShowVolume);
  const [isCapturing, setIsCapturing] = useState(false);

  /**
   * Take a screenshot of the chart using html2canvas
   * @param element - The HTML element to capture
   * @param filename - Optional custom filename for the download
   */
  const captureScreenshot = async (
    element: HTMLElement | null,
    filename?: string
  ): Promise<void> => {
    if (!element) return;

    setIsCapturing(true);

    try {
      // Dynamically import html2canvas to avoid SSR issues
      const html2canvas = (await import('html2canvas')).default;

      // Capture the chart element
      const canvas = await html2canvas(element, {
        backgroundColor: '#0a0a0a', // Dark background matching the app theme
        scale: 2, // Higher resolution for better quality
        logging: false,
        useCORS: true,
      });

      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = filename || `chart-${Date.now()}.png`;
          link.href = url;
          link.click();

          // Cleanup
          URL.revokeObjectURL(url);
        }
      }, 'image/png');
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  return {
    isLogScale,
    setIsLogScale,
    showVolume,
    setShowVolume,
    isCapturing,
    captureScreenshot,
  };
}
