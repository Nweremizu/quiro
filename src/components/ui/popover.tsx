"use client";

import * as React from "react";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import {
  AnimatePresence,
  motion,
  MotionConfig,
  Transition,
  Variants,
} from "motion/react";

import { cn } from "@/lib/utils";

const TRANSITION: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 30,
};

const CONTENT_VARIANTS: Variants = {
  initial: {
    opacity: 0,
    scale: 0.8,
    filter: "blur(10px)",
  },

  animate: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
  },

  exit: {
    opacity: 0,
    scale: 0.98,
    filter: "blur(8px)",
  },
};

function Popover({ children, ...props }: PopoverPrimitive.Root.Props) {
  return (
    <MotionConfig transition={TRANSITION}>
      <PopoverPrimitive.Root data-slot="popover" {...props}>
        {children}
      </PopoverPrimitive.Root>
    </MotionConfig>
  );
}

function PopoverTrigger({
  className,
  children,
  ...props
}: PopoverPrimitive.Trigger.Props &
  React.ComponentProps<typeof motion.button>) {
  return (
    <PopoverPrimitive.Trigger
      render={
        <motion.button whileTap={{ scale: 0.98 }} className={className} />
      }
      data-slot="popover-trigger"
      {...props}
    >
      {children}
    </PopoverPrimitive.Trigger>
  );
}

type PopoverContentProps = PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    transition?: Transition;
    variants?: Variants;
  };

function PopoverContent({
  className,

  align = "center",
  alignOffset = 0,

  side = "bottom",
  sideOffset = 8,

  transition,
  variants = CONTENT_VARIANTS,

  children,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <AnimatePresence mode="wait">
        <PopoverPrimitive.Positioner
          side={side}
          sideOffset={sideOffset}
          align={align}
          alignOffset={alignOffset}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            data-slot="popover-content"
            render={
              <motion.div
                initial="initial"
                animate="animate"
                exit="exit"
                variants={variants}
                transition={{
                  scale: {
                    type: "spring",
                    stiffness: 380,
                    damping: 30,
                  },

                  opacity: {
                    type: "tween",
                    duration: 0.18,
                    ease: "easeOut",
                  },

                  filter: {
                    type: "tween",
                    duration: 0.28,
                    ease: "easeOut",
                  },

                  ...transition,
                }}
                className={cn(
                  [
                    "z-50",
                    "flex w-72 flex-col gap-4",
                    "rounded-2xl",
                    "bg-popover",
                    "p-4",
                    "text-sm text-popover-foreground",

                    "shadow-2xl",
                    "ring-1 ring-black/5",

                    "origin-(--transform-origin)",

                    "will-change-transform",
                    "will-change-opacity",
                    "will-change-[filter]",

                    "outline-hidden",
                  ],
                  className,
                )}
              />
            }
            {...props}
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </AnimatePresence>
    </PopoverPrimitive.Portal>
  );
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-base font-medium", className)}
      {...props}
    />
  );
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
};
