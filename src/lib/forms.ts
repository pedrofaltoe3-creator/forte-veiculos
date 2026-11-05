import { startTransition, type FormEvent } from 'react';

// O React limpa o formulário ao terminar uma Server Action enviada por action={...}.
// Enviando por aqui, o que a pessoa digitou continua na tela se a validação recusar algum campo.
// O atributo action continua no form para o envio funcionar mesmo sem JavaScript.
export function submitKeepingValues(action: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
}
