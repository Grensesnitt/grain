import { Dto, t } from '@grensesnitt/grain';

export class CreateUserDto extends Dto(
  t.Object({
    name: t.String({ minLength: 1 }),
    email: t.String({ format: 'email' }),
    password: t.String({ minLength: 8 }),
  })
) {}
