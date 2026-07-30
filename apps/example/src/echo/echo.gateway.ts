import { Gateway, Public, t, type WsClient, type WsGateway } from '@grensesnitt/grain';

const EchoMessage = t.Object({ event: t.String() }, { additionalProperties: false });

@Gateway('/echo', { message: EchoMessage })
@Public()
export class EchoGateway implements WsGateway<{ event: string }> {
  message(client: WsClient, message: { event: string }) {
    client.send(message);
  }
}
