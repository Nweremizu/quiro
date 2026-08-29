import { useEffect, useRef } from "react";
import { events } from "./tauri";

type EventListener<T> = {
  listen: (callback: (event: { payload: T }) => void) => Promise<() => void>;
};

type EventKey = keyof typeof events;
type EventPayload<T> = T extends {
  listen: (
    callback: (event: { payload: infer Payload }) => void,
  ) => Promise<() => void>;
}
  ? Payload
  : never;

// This hook allows you to listen to Tauri events in a React component. It takes an event listener and a callback function as arguments.
// The callback will be called with the event payload whenever the event is emitted.
// The hook also ensures that the callback is always up-to-date and cleans up the event listener when the component unmounts or when the event listener changes.
export function useTauriEventListener<Payload>(
  eventListenter: EventListener<Payload>,
  callback: (payload: Payload) => void,
): void {
  const handlerRef = useRef(callback);
  handlerRef.current = callback;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    eventListenter
      .listen((event) => {
        if (!cancelled) {
          handlerRef.current(event.payload);
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [eventListenter]);
}

// This hook allows you to listen to Tauri events by their event key in a React component. It takes an event key and a callback function as arguments.
// The callback will be called with the event payload whenever the event is emitted.
// The hook also ensures that the callback is always up-to-date and cleans up the event listener when the component unmounts or when the event key changes.
export function useTauriEventListenerByKey<Key extends EventKey>(
  eventKey: Key,
  callback: (payload: EventPayload<(typeof events)[Key]>) => void,
): void {
  const eventListener = events[eventKey] as unknown as EventListener<
    EventPayload<(typeof events)[Key]>
  >;
  useTauriEventListener(eventListener, callback);
}
