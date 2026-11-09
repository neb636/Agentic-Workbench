import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
export function useChoiceDialog() {
  const [choice, setChoice] = useState<{ title: string; message: string; options: string[]; resolve: (choice: string) => void }>();
  const choose = (title: string, message: string, options: string[]) => new Promise<string>((resolve) => setChoice({ title, message, options, resolve }));
  const finish = (value: string) => { choice?.resolve(value); setChoice(undefined); };
  return { choose, dialog: choice && <ModalOverlay className="wb-modal-overlay" isOpen isDismissable onOpenChange={(open) => { if (!open) finish("Cancel"); }}><Modal className="wb-modal wb-alert"><Dialog role="alertdialog" className="wb-dialog"><Heading slot="title">{choice.title}</Heading><p>{choice.message}</p><div className="dialog-actions">{choice.options.map((option) => <Button key={option} className="wb-button" onPress={() => finish(option)}>{option}</Button>)}</div></Dialog></Modal></ModalOverlay> };
}
