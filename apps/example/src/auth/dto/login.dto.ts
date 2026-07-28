import { Dto, t } from '@grensesnitt/grain';

export class LoginDto extends Dto(
  t.Object({
    email: t.String({ format: 'email' }),
    password: t.String(),
  })
) {}
