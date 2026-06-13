import { cn } from "@/lib/utils"
import { HugeiconsIcon, type HugeiconsProps } from "@hugeicons/react"
import { Loading03Icon } from "@hugeicons/core-free-icons"

function Spinner({ className, size = 16, ...props }: Omit<HugeiconsProps, "icon">) {
  return (
    <HugeiconsIcon icon={Loading03Icon} size={size} strokeWidth={2} role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
