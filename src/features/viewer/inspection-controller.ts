export type InspectionState =
  | { phase: 'overview'; selectedId: null; transitionId: number }
  | {
      phase: 'focusing' | 'inspecting' | 'returning';
      selectedId: string;
      transitionId: number;
    };

export function createInspectionController(itemIds: readonly string[]) {
  const validIds = new Set(itemIds);
  const listeners = new Set<() => void>();
  let state: InspectionState = {
    phase: 'overview',
    selectedId: null,
    transitionId: 0,
  };

  function update(nextState: InspectionState): void {
    state = nextState;
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getSnapshot(): InspectionState {
      return state;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    select(id: string): void {
      if (!validIds.has(id)) {
        throw new RangeError(`Unknown exhibit id: ${id}`);
      }
      if (
        (state.phase === 'focusing' || state.phase === 'inspecting') &&
        state.selectedId === id
      ) {
        return;
      }
      update({
        phase: 'focusing',
        selectedId: id,
        transitionId: state.transitionId + 1,
      });
    },

    returnToOverview(): void {
      if (state.phase !== 'focusing' && state.phase !== 'inspecting') {
        return;
      }
      update({
        phase: 'returning',
        selectedId: state.selectedId,
        transitionId: state.transitionId + 1,
      });
    },

    finishTransition(expectedTransitionId: number): void {
      if (state.transitionId !== expectedTransitionId) {
        return;
      }
      if (state.phase === 'focusing') {
        update({
          phase: 'inspecting',
          selectedId: state.selectedId,
          transitionId: state.transitionId,
        });
      } else if (state.phase === 'returning') {
        update({
          phase: 'overview',
          selectedId: null,
          transitionId: state.transitionId,
        });
      }
    },
  };
}
