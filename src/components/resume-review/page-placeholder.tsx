import { Skeleton } from "@/components/ui/skeleton";

/**
 * The first resume page's outline, sized and placed exactly where PdfPane will
 * draw it at 100% (container width less the 16px gutters, capped at Letter
 * width). Pure CSS, so every loading phase shows the same shape in the same
 * spot, before anything has been measured and without loading the PDF library.
 */
export function ResumePagePlaceholder() {
  return (
    <div className="flex justify-center p-4">
      <Skeleton className="aspect-[8.5/11] w-full max-w-[816px] rounded-none" />
    </div>
  );
}
