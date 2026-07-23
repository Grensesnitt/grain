import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuard,
  t, type Static,
} from '@grensesnitt/grain'
import { AuthGuard } from '../auth/auth.guard'
import { UserService } from './user.service'

const CreateUser = t.Object({
  name: t.String({ minLength: 1 }),
  email: t.String({ format: 'email' }),
})

const IdParams = t.Object({ id: t.Number() })

@Controller('/users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get('/')
  list() {
    return this.users.list()
  }

  @Get('/:id', { params: IdParams })
  getOne(@Param('id') id: number) {
    return this.users.find(id)
  }

  @Post('/', { body: CreateUser })
  @HttpCode(201)
  @UseGuard(AuthGuard)
  create(@Body() body: Static<typeof CreateUser>) {
    return this.users.create(body)
  }

  @Delete('/:id', { params: IdParams })
  @UseGuard(AuthGuard)
  remove(@Param('id') id: number) {
    this.users.remove(id)
  }
}
