"use client";

/**
 * PromptInput — trimmed AI Elements composer.
 *
 * The upstream AI Elements `prompt-input` ships ~1,500 lines of attachments,
 * screenshot capture, hover-card previews, model selectors, tabs and a command
 * palette — most of which assume Radix primitives and break against this repo's
 * Base UI ("base-maia") shadcn style. The editor chat only needs a textarea +
 * send/stop button, so this is a focused composer built on the repo's own
 * `input-group` primitives. It keeps the AI Elements public API (PromptInput,
 * PromptInputBody, PromptInputTextarea, PromptInputToolbar, PromptInputTools,
 * PromptInputButton, PromptInputSubmit) so call sites read the same.
 */
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ChatStatus } from "ai";
import { CornerDownLeftIcon, SquareIcon, XIcon } from "lucide-react";
import type {
  ComponentProps,
  FormEvent,
  FormEventHandler,
  KeyboardEvent,
  ReactNode,
} from "react";

/** The payload handed to `onSubmit`. Trimmed to text (no attachments). */
export type PromptInputMessage = {
  text: string;
};

export type PromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
  onSubmit?: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void;
};

export const PromptInput = ({
  className,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const text = ((formData.get("message") as string | null) ?? "").trim();
    onSubmit?.({ text }, event);
  };

  return (
    <form className={cn("w-full", className)} onSubmit={handleSubmit} {...props}>
      <InputGroup>{children}</InputGroup>
    </form>
  );
};

export type PromptInputBodyProps = ComponentProps<"div">;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
>;

export const PromptInputTextarea = ({
  className,
  name = "message",
  placeholder = "Ask me to edit…",
  onKeyDown,
  ...props
}: PromptInputTextareaProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits, Shift+Enter inserts a newline. Ignore IME composition.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
    onKeyDown?.(event);
  };

  return (
    <InputGroupTextarea
      name={name}
      placeholder={placeholder}
      className={cn("min-h-[2.5rem]", className)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
};

export type PromptInputToolbarProps = ComponentProps<typeof InputGroupAddon>;

export const PromptInputToolbar = ({
  className,
  ...props
}: PromptInputToolbarProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("justify-between gap-1", className)}
    {...props}
  />
);

export type PromptInputToolsProps = ComponentProps<"div">;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props} />
);

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton>;

export const PromptInputButton = ({
  className,
  variant = "ghost",
  size = "icon-xs",
  ...props
}: PromptInputButtonProps) => (
  <InputGroupButton
    className={className}
    size={size}
    type="button"
    variant={variant}
    {...props}
  />
);

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
};

export const PromptInputSubmit = ({
  className,
  size = "icon-xs",
  status,
  children,
  ...props
}: PromptInputSubmitProps) => {
  let icon: ReactNode = <CornerDownLeftIcon className="size-4" />;
  if (status === "submitted") {
    icon = <Spinner className="size-4" />;
  } else if (status === "streaming") {
    icon = <SquareIcon className="size-4" />;
  } else if (status === "error") {
    icon = <XIcon className="size-4" />;
  }

  return (
    <InputGroupButton
      className={cn("rounded-full", className)}
      size={size}
      type="submit"
      variant="default"
      {...props}
    >
      {children ?? icon}
    </InputGroupButton>
  );
};
