import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addCustomFont,
  type CustomFont,
  DuplicateFontError,
  generateFontId,
  isValidGoogleFontsUrl,
  parseFontFamilyFromImport,
} from "@/lib/customFonts";
import { useScopedT } from "../../contexts/I18nContext";
import { HugeiconsIcon } from "@hugeicons/react";
import { Plus } from "@hugeicons/core-free-icons";

interface AddCustomFontDialogProps {
  onFontAdded?: (font: CustomFont) => void;
}

const ADD_FONT_DIALOG_CONTENT_CLASS =
  "max-w-md bg-card shadow-lg border-(--border-default) text-foreground [&>button]:text-muted-foreground [&>button:hover]:text-foreground";
const ADD_FONT_FIELD_CLASS = "space-y-2.5";
const ADD_FONT_LABEL_CLASS = "text-[12px] font-medium text-foreground";
const ADD_FONT_HELP_CLASS = "text-[12px] leading-relaxed text-muted-foreground";
const ADD_FONT_INPUT_CLASS =
  "h-9 rounded-md border-border bg-input/30 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/45 focus-visible:ring-primary/20";

export function AddCustomFontDialog({ onFontAdded }: AddCustomFontDialogProps) {
  const t = useScopedT("dialogs");
  const [open, setOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [fontName, setFontName] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setImportUrl("");
    setFontName("");
    setLoading(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  };

  const handleImportUrlChange = (url: string) => {
    setImportUrl(url);

    // Auto-extract font name if valid Google Fonts URL
    if (isValidGoogleFontsUrl(url)) {
      const extracted = parseFontFamilyFromImport(url);
      if (extracted && !fontName) {
        setFontName(extracted);
      }
    }
  };

  const handleAdd = async () => {
    const normalizedImportUrl = importUrl.trim();
    const normalizedFontName = fontName.trim();

    // Validate inputs
    if (!normalizedImportUrl) {
      toast.error(t("addFont.enterUrl"));
      return;
    }

    if (!isValidGoogleFontsUrl(normalizedImportUrl)) {
      toast.error(t("addFont.invalidUrl"));
      return;
    }

    if (!normalizedFontName) {
      toast.error(t("addFont.enterName"));
      return;
    }

    setLoading(true);

    try {
      // Extract font family from URL
      const fontFamily = parseFontFamilyFromImport(normalizedImportUrl);
      if (!fontFamily) {
        toast.error(t("addFont.extractFailed"));
        return;
      }

      // Create custom font object
      const newFont: CustomFont = {
        id: generateFontId(normalizedFontName),
        name: normalizedFontName,
        fontFamily: fontFamily,
        importUrl: normalizedImportUrl,
      };

      // Add font (this will load and verify it) - throws if it fails
      await addCustomFont(newFont);

      // Notify parent
      if (onFontAdded) {
        onFontAdded(newFont);
      }

      toast.success(
        t("addFont.addSuccess", undefined, { name: normalizedFontName }),
      );

      // Reset and close
      handleOpenChange(false);
    } catch (error) {
      console.error("Failed to add custom font:", error);
      if (error instanceof DuplicateFontError) {
        toast.error(t("addFont.addFailed"), {
          description: t(
            "addFont.alreadyAdded",
            "This font has already been added.",
          ),
        });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Failed to load font";
      toast.error(t("addFont.addFailed"), {
        description: errorMessage.includes("timeout")
          ? t("addFont.loadTimeout")
          : t("addFont.loadFailed"),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleAdd();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full rounded-md border-border bg-transparent text-xs text-foreground hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <HugeiconsIcon icon={Plus} className="h-3.5 w-3.5" />
          {t("addFont.title")}
        </Button>
      </DialogTrigger>
      <DialogContent className={ADD_FONT_DIALOG_CONTENT_CLASS}>
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-[-0.02em] text-foreground">
            {t("addFont.heading")}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
            {t("addFont.description")}
          </DialogDescription>
        </DialogHeader>

        <form className="mt-1 space-y-5" onSubmit={handleSubmit}>
          <div className={ADD_FONT_FIELD_CLASS}>
            <Label htmlFor="import-url" className={ADD_FONT_LABEL_CLASS}>
              {t("addFont.urlLabel")}
            </Label>
            <Input
              id="import-url"
              placeholder={t("addFont.urlPlaceholder")}
              value={importUrl}
              onChange={(e) => handleImportUrlChange(e.target.value)}
              className={ADD_FONT_INPUT_CLASS}
            />
            <p className={ADD_FONT_HELP_CLASS}>
              {t("addFont.urlHelp")}
            </p>
          </div>

          <div className={ADD_FONT_FIELD_CLASS}>
            <Label htmlFor="font-name" className={ADD_FONT_LABEL_CLASS}>
              {t("addFont.nameLabel")}
            </Label>
            <Input
              id="font-name"
              placeholder={t("addFont.namePlaceholder")}
              value={fontName}
              onChange={(e) => setFontName(e.target.value)}
              className={ADD_FONT_INPUT_CLASS}
            />
            <p className={ADD_FONT_HELP_CLASS}>
              {t("addFont.nameHelp")}
            </p>
          </div>

          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border bg-transparent text-foreground hover:bg-foreground/[0.04] hover:text-foreground"
            >
              {t("addFont.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {loading ? t("addFont.adding") : t("addFont.addFont")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
