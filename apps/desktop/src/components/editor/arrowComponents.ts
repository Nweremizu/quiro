import type { ArrowDirection } from "@/types/editor";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
} from "./ArrowSvgs";

export function getArrowComponent(direction: ArrowDirection) {
  switch (direction) {
    case "up":
      return ArrowUp;
    case "down":
      return ArrowDown;
    case "left":
      return ArrowLeft;
    case "right":
      return ArrowRight;
    case "up-right":
      return ArrowUpRight;
    case "up-left":
      return ArrowUpLeft;
    case "down-right":
      return ArrowDownRight;
    case "down-left":
      return ArrowDownLeft;
  }
}
