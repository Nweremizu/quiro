use std::borrow::Cow;

use quiro_cursor_info::{CursorShape, CursorShapeMacOS, CursorShapeWindows};
use quiro_project::CursorType;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(super) enum CursorMode {
    Arrow,
    PointingHand,
    Text,
    VerticalText,
    Crosshair,
    OpenHand,
    ClosedHand,
    ResizeHorizontal,
    ResizeVertical,
    ResizeNwse,
    ResizeNesw,
    Move,
    NotAllowed,
    Busy,
    Pen,
    ZoomIn,
    ZoomOut,
    Copy,
    Link,
    ContextMenu,
}

pub(super) struct CursorArtwork {
    pub svg: Cow<'static, str>,
    pub hotspot: (f64, f64),
}

pub(super) fn mode_for_shape(shape: Option<CursorShape>) -> CursorMode {
    match shape {
        Some(CursorShape::MacOS(shape)) => macos_mode(shape),
        Some(CursorShape::Windows(shape)) => windows_mode(shape),
        None => CursorMode::Arrow,
    }
}

pub(super) fn artwork(cursor_type: &CursorType, mode: CursorMode) -> Option<CursorArtwork> {
    match cursor_type {
        CursorType::MacosDark => macos_artwork(mode),
        CursorType::Rounded | CursorType::Capsule => themed_artwork(cursor_type, mode),
        CursorType::Auto | CursorType::Pointer | CursorType::Circle => None,
    }
}

fn macos_mode(shape: CursorShapeMacOS) -> CursorMode {
    match shape {
        CursorShapeMacOS::Arrow | CursorShapeMacOS::TahoeArrow => CursorMode::Arrow,
        CursorShapeMacOS::ContextualMenu | CursorShapeMacOS::TahoeContextualMenu => {
            CursorMode::ContextMenu
        }
        CursorShapeMacOS::ClosedHand | CursorShapeMacOS::TahoeClosedHand => CursorMode::ClosedHand,
        CursorShapeMacOS::Crosshair | CursorShapeMacOS::TahoeCrosshair => CursorMode::Crosshair,
        CursorShapeMacOS::DisappearingItem | CursorShapeMacOS::TahoeDisappearingItem => {
            CursorMode::NotAllowed
        }
        CursorShapeMacOS::DragCopy | CursorShapeMacOS::TahoeDragCopy => CursorMode::Copy,
        CursorShapeMacOS::DragLink | CursorShapeMacOS::TahoeDragLink => CursorMode::Link,
        CursorShapeMacOS::IBeam | CursorShapeMacOS::TahoeIBeam => CursorMode::Text,
        CursorShapeMacOS::OpenHand | CursorShapeMacOS::TahoeOpenHand => CursorMode::OpenHand,
        CursorShapeMacOS::OperationNotAllowed | CursorShapeMacOS::TahoeOperationNotAllowed => {
            CursorMode::NotAllowed
        }
        CursorShapeMacOS::PointingHand | CursorShapeMacOS::TahoePointingHand => {
            CursorMode::PointingHand
        }
        CursorShapeMacOS::ResizeDown
        | CursorShapeMacOS::ResizeUp
        | CursorShapeMacOS::ResizeUpDown
        | CursorShapeMacOS::TahoeResizeDown
        | CursorShapeMacOS::TahoeResizeUp
        | CursorShapeMacOS::TahoeResizeUpDown => CursorMode::ResizeVertical,
        CursorShapeMacOS::ResizeLeft
        | CursorShapeMacOS::ResizeRight
        | CursorShapeMacOS::ResizeLeftRight
        | CursorShapeMacOS::TahoeResizeLeft
        | CursorShapeMacOS::TahoeResizeRight
        | CursorShapeMacOS::TahoeResizeLeftRight => CursorMode::ResizeHorizontal,
        CursorShapeMacOS::IBeamVerticalForVerticalLayout
        | CursorShapeMacOS::TahoeIBeamVerticalForVerticalLayout => CursorMode::VerticalText,
        CursorShapeMacOS::TahoeZoomIn => CursorMode::ZoomIn,
        CursorShapeMacOS::TahoeZoomOut => CursorMode::ZoomOut,
    }
}

fn windows_mode(shape: CursorShapeWindows) -> CursorMode {
    match shape {
        CursorShapeWindows::Arrow
        | CursorShapeWindows::UpArrow
        | CursorShapeWindows::Pin
        | CursorShapeWindows::Person => CursorMode::Arrow,
        CursorShapeWindows::IBeam => CursorMode::Text,
        CursorShapeWindows::Wait | CursorShapeWindows::AppStarting => CursorMode::Busy,
        CursorShapeWindows::Cross => CursorMode::Crosshair,
        CursorShapeWindows::SizeNWSE => CursorMode::ResizeNwse,
        CursorShapeWindows::SizeNESW => CursorMode::ResizeNesw,
        CursorShapeWindows::SizeWE
        | CursorShapeWindows::ScrollWE
        | CursorShapeWindows::ScrollW
        | CursorShapeWindows::ScrollE => CursorMode::ResizeHorizontal,
        CursorShapeWindows::SizeNS
        | CursorShapeWindows::ScrollNS
        | CursorShapeWindows::ScrollN
        | CursorShapeWindows::ScrollS => CursorMode::ResizeVertical,
        CursorShapeWindows::SizeAll
        | CursorShapeWindows::ScrollNSEW
        | CursorShapeWindows::ArrowCD => CursorMode::Move,
        CursorShapeWindows::No => CursorMode::NotAllowed,
        CursorShapeWindows::Hand => CursorMode::PointingHand,
        CursorShapeWindows::Help => CursorMode::ContextMenu,
        CursorShapeWindows::Pen => CursorMode::Pen,
        CursorShapeWindows::ScrollNW | CursorShapeWindows::ScrollSE => CursorMode::ResizeNwse,
        CursorShapeWindows::ScrollNE | CursorShapeWindows::ScrollSW => CursorMode::ResizeNesw,
    }
}

fn macos_artwork(mode: CursorMode) -> Option<CursorArtwork> {
    let shape = match mode {
        CursorMode::Arrow => Some(CursorShapeMacOS::TahoeArrow),
        CursorMode::PointingHand => Some(CursorShapeMacOS::TahoePointingHand),
        CursorMode::Text => Some(CursorShapeMacOS::TahoeIBeam),
        CursorMode::VerticalText => Some(CursorShapeMacOS::TahoeIBeamVerticalForVerticalLayout),
        CursorMode::Crosshair | CursorMode::Pen => Some(CursorShapeMacOS::TahoeCrosshair),
        CursorMode::OpenHand => Some(CursorShapeMacOS::TahoeOpenHand),
        CursorMode::ClosedHand => Some(CursorShapeMacOS::TahoeClosedHand),
        CursorMode::ResizeHorizontal => Some(CursorShapeMacOS::TahoeResizeLeftRight),
        CursorMode::ResizeVertical => Some(CursorShapeMacOS::TahoeResizeUpDown),
        CursorMode::NotAllowed => Some(CursorShapeMacOS::TahoeOperationNotAllowed),
        CursorMode::ZoomIn => Some(CursorShapeMacOS::TahoeZoomIn),
        CursorMode::ZoomOut => Some(CursorShapeMacOS::TahoeZoomOut),
        CursorMode::Copy => Some(CursorShapeMacOS::TahoeDragCopy),
        CursorMode::Link => Some(CursorShapeMacOS::TahoeDragLink),
        CursorMode::ContextMenu => Some(CursorShapeMacOS::TahoeContextualMenu),
        CursorMode::ResizeNwse | CursorMode::ResizeNesw | CursorMode::Move | CursorMode::Busy => {
            None
        }
    };

    if let Some(resolved) = shape.and_then(|shape| shape.resolve()) {
        return Some(CursorArtwork {
            svg: Cow::Borrowed(resolved.raw),
            hotspot: resolved.hotspot,
        });
    }

    themed_artwork(&CursorType::MacosDark, mode)
}

fn themed_artwork(cursor_type: &CursorType, mode: CursorMode) -> Option<CursorArtwork> {
    let (fill, outline, accent, width) = match cursor_type {
        CursorType::MacosDark => ("#171719", "#ffffff", "#ffffff", 2.2),
        CursorType::Rounded => ("#ff7a1a", "#ffffff", "#242428", 2.4),
        CursorType::Capsule => ("#232326", "#ff8a2a", "#ff8a2a", 2.5),
        CursorType::Auto | CursorType::Pointer | CursorType::Circle => return None,
    };
    let style = format!(
        "fill=\"{fill}\" stroke=\"{outline}\" stroke-width=\"{width}\" stroke-linecap=\"round\" stroke-linejoin=\"round\""
    );
    let accent_style = format!(
        "fill=\"none\" stroke=\"{accent}\" stroke-width=\"{width}\" stroke-linecap=\"round\" stroke-linejoin=\"round\""
    );
    let (body, hotspot) = match mode {
        CursorMode::Arrow => (
            format!("<path d=\"M5 4v27l7-7 5.7 11.8 5.2-2.5-5.7-11.6h10.5L5 4Z\" {style}/>"),
            (0.12, 0.1),
        ),
        CursorMode::PointingHand => (
            format!(
                "<path d=\"M11 18V6.5a3 3 0 0 1 6 0V14h1V9.5a2.5 2.5 0 0 1 5 0V14h1v-2.5a2.5 2.5 0 0 1 5 0V24c0 7-4.5 11-11 11h-1c-4.5 0-7.1-2.2-9.5-5.3L3.7 25a3 3 0 0 1 4.4-4.1L11 23.3V18Z\" {style}/>"
            ),
            (0.39, 0.1),
        ),
        CursorMode::Text => (
            format!("<path d=\"M10 4h14M17 4v30M10 34h14M13 19h8\" {accent_style}/>"),
            (0.5, 0.5),
        ),
        CursorMode::VerticalText => (
            format!("<path d=\"M3 12v14M3 19h30M33 12v14M18 15v8\" {accent_style}/>"),
            (0.5, 0.5),
        ),
        CursorMode::Crosshair => (
            format!(
                "<circle cx=\"19\" cy=\"19\" r=\"6\" {accent_style}/><path d=\"M19 3v10m0 12v10M3 19h10m12 0h10\" {accent_style}/>"
            ),
            (0.5, 0.5),
        ),
        CursorMode::OpenHand => (
            format!(
                "<path d=\"M8 19v-7a2.5 2.5 0 0 1 5 0v5-9a2.5 2.5 0 0 1 5 0v9-7a2.5 2.5 0 0 1 5 0v7-4a2.5 2.5 0 0 1 5 0v10c0 7-4 11-10.5 11C10 34 6 29 4 24a4 4 0 0 1 4-5Z\" {style}/>"
            ),
            (0.47, 0.5),
        ),
        CursorMode::ClosedHand => (
            format!(
                "<path d=\"M8 14a3 3 0 0 1 5-2.2 3 3 0 0 1 5-2 3 3 0 0 1 5 1.2 3 3 0 0 1 5 2.2V25c0 6-4 10-10 10S7 31 7 25V14Z\" {style}/><path d=\"M12 13v8m6-10v10m5-8v8\" {accent_style}/>"
            ),
            (0.5, 0.5),
        ),
        CursorMode::ResizeHorizontal => (
            format!("<path d=\"m3 19 8-7v5h16v-5l8 7-8 7v-5H11v5l-8-7Z\" {style}/>"),
            (0.5, 0.5),
        ),
        CursorMode::ResizeVertical => (
            format!("<path d=\"M19 3l7 8h-5v16h5l-7 8-7-8h5V11h-5l7-8Z\" {style}/>"),
            (0.5, 0.5),
        ),
        CursorMode::ResizeNwse => (
            format!(
                "<path d=\"M6 5h10l-3.7 3.7 17 17L33 22v10H23l3.7-3.7-17-17L6 15V5Z\" {style}/>"
            ),
            (0.5, 0.5),
        ),
        CursorMode::ResizeNesw => (
            format!(
                "<path d=\"M22 5h10v10l-3.7-3.7-17 17L15 32H5V22l3.7 3.7 17-17L22 5Z\" {style}/>"
            ),
            (0.5, 0.5),
        ),
        CursorMode::Move => (
            format!(
                "<path d=\"m19 2 6 7h-4v8h8v-4l7 6-7 6v-4h-8v8h4l-6 7-6-7h4v-8H9v4l-7-6 7-6v4h8V9h-4l6-7Z\" {style}/>"
            ),
            (0.5, 0.5),
        ),
        CursorMode::NotAllowed => (
            format!(
                "<circle cx=\"19\" cy=\"19\" r=\"14\" {style}/><path d=\"M9 9l20 20\" {accent_style}/>"
            ),
            (0.5, 0.5),
        ),
        CursorMode::Busy => (
            format!(
                "<circle cx=\"19\" cy=\"19\" r=\"13\" fill=\"none\" stroke=\"{outline}\" stroke-width=\"{width}\" opacity=\".28\"/><path d=\"M19 6a13 13 0 0 1 13 13\" {accent_style}/><circle cx=\"19\" cy=\"19\" r=\"3\" fill=\"{fill}\"/>"
            ),
            (0.5, 0.5),
        ),
        CursorMode::Pen => (
            format!(
                "<path d=\"m7 29 3-8L27 4l7 7-17 17-8 3-2-2Z\" {style}/><path d=\"m11 21 6 6M27 5l6 6\" {accent_style}/>"
            ),
            (0.2, 0.82),
        ),
        CursorMode::ZoomIn | CursorMode::ZoomOut => {
            let sign = if mode == CursorMode::ZoomIn {
                "<path d=\"M17 11v12m-6-6h12\""
            } else {
                "<path d=\"M11 17h12\""
            };
            (
                format!(
                    "<circle cx=\"17\" cy=\"17\" r=\"12\" {style}/><path d=\"m26 26 8 8\" {accent_style}/>{sign} {accent_style}/>"
                ),
                (0.45, 0.45),
            )
        }
        CursorMode::Copy | CursorMode::Link | CursorMode::ContextMenu => {
            let badge = match mode {
                CursorMode::Copy => format!("<path d=\"M27 23v10m-5-5h10\" {accent_style}/>"),
                CursorMode::Link => {
                    format!("<path d=\"M22 28h4l2-2m-2-4h-4l-2 2m3 1h2\" {accent_style}/>")
                }
                CursorMode::ContextMenu => {
                    format!("<path d=\"M23 23h10M23 28h10M23 33h7\" {accent_style}/>")
                }
                _ => String::new(),
            };
            (
                format!(
                    "<path d=\"M4 3v25l6.5-6.4 5.2 10.8 5-2.4-5.2-10.5h9.7L4 3Z\" {style}/>{badge}"
                ),
                (0.1, 0.08),
            )
        }
    };

    Some(CursorArtwork {
        svg: Cow::Owned(format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"38\" height=\"38\" viewBox=\"0 0 38 38\">{body}</svg>"
        )),
        hotspot,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODES: [CursorMode; 20] = [
        CursorMode::Arrow,
        CursorMode::PointingHand,
        CursorMode::Text,
        CursorMode::VerticalText,
        CursorMode::Crosshair,
        CursorMode::OpenHand,
        CursorMode::ClosedHand,
        CursorMode::ResizeHorizontal,
        CursorMode::ResizeVertical,
        CursorMode::ResizeNwse,
        CursorMode::ResizeNesw,
        CursorMode::Move,
        CursorMode::NotAllowed,
        CursorMode::Busy,
        CursorMode::Pen,
        CursorMode::ZoomIn,
        CursorMode::ZoomOut,
        CursorMode::Copy,
        CursorMode::Link,
        CursorMode::ContextMenu,
    ];

    #[test]
    fn every_custom_family_mode_has_valid_svg() {
        for cursor_type in [
            CursorType::MacosDark,
            CursorType::Rounded,
            CursorType::Capsule,
        ] {
            for mode in MODES {
                let artwork = artwork(&cursor_type, mode).unwrap();
                resvg::usvg::Tree::from_str(&artwork.svg, &resvg::usvg::Options::default())
                    .unwrap();
                assert!((0.0..=1.0).contains(&artwork.hotspot.0));
                assert!((0.0..=1.0).contains(&artwork.hotspot.1));
            }
        }
    }
}
