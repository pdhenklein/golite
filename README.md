# GoLite

Compartilhamento de tela P2P leve, com baixa latência, feito em Electron.

## Instalar
1. Baixe `GoLite-Windows.zip` na aba **Releases**.
2. Extraia e abra `GoLite.exe`.
3. Próximas versões: clique em **⟳ Atualizar** no topo do app.

## Como usar
- Seu código (`GL-XXXXXX`) é fixo e sua sala fica sempre aberta.
- Passe o código para um amigo; ele pede entrada e você aceita.
- **Compartilhar a tela** inicia a live; **Encerrar Transmissão** termina.

## Para quem mantém o projeto
```powershell
.\publish.ps1 -Version 1.1.0 -Notes "O que mudou"
```
Gera `app.zip`, envia o código e cria a Release. O app dos usuários detecta a nova versão sozinho.

## Licença
MIT
