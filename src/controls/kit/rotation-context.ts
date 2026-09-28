'use client';
// The quarter-turn rotation of the cell a control is placed in. Read by
// useTrackedPointer so controls always see touches in their own frame.
import { createContext, useContext } from 'react';
import type { Rotation } from '../api.ts';

export const RotationContext = createContext<Rotation>(0);
export const useRotation = () => useContext(RotationContext);
