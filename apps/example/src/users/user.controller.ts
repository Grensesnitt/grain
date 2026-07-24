import {
  Body,
  Controller,
  Delete,
  Dto,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuard,
  t,
} from '@grensesnitt/grain';
import { AuthGuard } from '../auth/auth.guard';
import { UserService } from './user.service';

class CreateUserDto extends Dto(
  t.Object({
    name: t.String({ minLength: 1 }),
    email: t.String({ format: 'email' }),
    password: t.String({ minLength: 8 }),
  })
) {}

@Controller('/users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get('/')
  list() {
    return this.users.list();
  }

  @Get('/:id')
  getOne(@Param('id') id: number) {
    return this.users.find(id);
  }

  @Post('/')
  @HttpCode(201)
  @UseGuard(AuthGuard)
  create(@Body() body: CreateUserDto) {
    return this.users.create(body);
  }

  @Delete('/:id')
  @UseGuard(AuthGuard)
  remove(@Param('id') id: number) {
    this.users.remove(id);
  }
}
