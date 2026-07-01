import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

/** Muted pill track shared by section-level tab rows. */
export const sectionTabsTrackClass = "rounded-full bg-muted/60 p-1.5"

/** Inline track (Publish/Published) — level-1 primary nav. */
export const sectionTabsInlineListClass =
  "inline-flex h-12 items-center gap-1 rounded-full border border-border/50 bg-muted/60 p-1.5 shadow-sm sm:h-11"

/** Grid track for three entity tabs. */
export const sectionTabsGrid3ListClass =
  `grid h-12 w-full max-w-xl grid-cols-3 gap-1 ${sectionTabsTrackClass} sm:h-11`

/** Grid track for two entity tabs. */
export const sectionTabsGrid2ListClass =
  `grid h-12 w-full max-w-md grid-cols-2 gap-1 ${sectionTabsTrackClass} sm:h-11`

/** Trigger sizing for three-column entity tabs (matches TabsTrigger base + overrides). */
export const sectionTabsTriggerCompactClass =
  "h-full gap-1 rounded-full px-2 py-2 text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:gap-2 sm:px-4 sm:text-[13px]"

/** Trigger sizing for two-column entity tabs. */
export const sectionTabsTriggerWideClass =
  "h-full gap-2 rounded-full px-4 py-2 text-[13px] font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"

/** Plain-button twin of sectionTabsTriggerCompactClass for Publish/Published nav. */
export const sectionTabButtonClass =
  "inline-flex h-full items-center justify-center whitespace-nowrap rounded-full py-2 font-medium transition-all gap-1 px-2 text-[11px] sm:gap-2 sm:px-4 sm:text-[13px]"

export const sectionTabButtonActiveClass =
  "bg-background text-foreground shadow-sm"

export const sectionTabButtonInactiveClass =
  "text-muted-foreground hover:text-foreground"

/** Level-2 entity nav — underline tabs (subordinate to primary pills). */
export const entityNavListClass =
  "flex h-auto w-full max-w-xl items-end justify-start gap-0 rounded-none border-b border-border/50 bg-transparent p-0"

export const entityNavList2Class =
  "flex h-auto w-full max-w-md items-end justify-start gap-0 rounded-none border-b border-border/50 bg-transparent p-0"

export const entityNavTriggerCompactClass =
  "h-auto flex-1 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-2 pb-3 pt-1 text-[11px] font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:gap-2 sm:px-4 sm:text-[13px]"

export const entityNavTriggerWideClass =
  "h-auto flex-1 gap-2 rounded-none border-b-2 border-transparent bg-transparent px-4 pb-3 pt-1 text-[13px] font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"

/** Level-3 editor mode — in-form pill toggle (Form / JSON).
 *  Uses rounded-full (nav control), not rounded-xl (inputs/buttons). */
export const editorModeListClass =
  "mb-2 inline-flex h-11 w-full max-w-xs gap-1 rounded-full bg-muted/60 p-1.5"

export const editorModeTriggerClass =
  "h-full flex-1 rounded-full px-4 text-[13px] font-medium text-muted-foreground shadow-none data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-full bg-muted/55 p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_3px_rgba(15,23,42,0.08)]",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
