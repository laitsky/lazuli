import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Badge component variants
 * Used for status indicators, labels, and tags
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/20 backdrop-blur-sm",
        secondary:
          "border-transparent bg-secondary/50 text-secondary-foreground hover:bg-secondary/80 backdrop-blur-sm",
        destructive:
          "border-transparent bg-destructive/10 text-destructive ring-1 ring-destructive/20 hover:bg-destructive/20 backdrop-blur-sm",
        outline: "text-foreground border-border hover:bg-accent hover:text-accent-foreground",
        success:
          "border-transparent bg-success/10 text-success ring-1 ring-success/20 hover:bg-success/20 backdrop-blur-sm",
        warning:
          "border-transparent bg-warning/10 text-warning ring-1 ring-warning/20 hover:bg-warning/20 backdrop-blur-sm",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof badgeVariants> { }

/**
 * Badge component for displaying status, labels, or categories
 */
function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
