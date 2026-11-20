import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
export const ErrorContext = createContext("");
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("button", className)} {...props} />;
}
export function Dialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const error = useContext(ErrorContext);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="overlay" />
        <DialogPrimitive.Content
          className="dialog"
          onEscapeKeyDown={(e) => {
            if (
              document.activeElement?.matches(
                '[role="combobox"][aria-expanded="true"]',
              )
            )
              e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(
              () =>
                returnFocus.current?.isConnected && returnFocus.current.focus(),
            );
          }}
        >
          <div className="dialog-header">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description>
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button className="icon-button" aria-label="Close dialog">
                <X size={20} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {error && (
            <p className="banner error" role="alert">
              {error}
            </p>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
