# The resolver template (resolve flow, validator wiring, formatResponse)

The full shape of a mutation resolver, with every standard method filled in. Copy this skeleton and
replace the operation-specific parts (models, guards, columns). Keep the method **order** and the
`resolve()` **flow** identical across resolvers — see the [SKILL](../SKILL.md#2-the-resolve-flow-and-method-order).

> Examples use a generic `Article` entity (fields `title` / `content`, audit columns
> `CreatedByUserId` / `LastModifiedByUserId` / `lastModifiedAt`). Swap in your own model.

## Full template

```js
import {
  BaseMutationResolver,
} from '@openreachtech/renchan'

import UpdateArticleInputValidator from '../../../../../../app/validator/forResolver/user/mutations/UpdateArticleInputValidator.js'

import Article from '../../../../../../sequelize/models/Article.js'

export default class UpdateArticleMutationResolver extends BaseMutationResolver {
  /** @override */
  static get schema () {
    return 'updateArticle'
  }

  /** @override */
  static get errorCodeHash () {
    return {
      ...super.errorCodeHash,

      // Invalid Input Errors
      InvalidArticleId: '203.M012.001',
      InvalidContent: '203.M012.002',
      InvalidTitle: '203.M012.003',

      // Database Errors
      ArticleNotFound: '204.M012.002',
      CurrentArticleContentIsSameAsTheNewOne: '204.M012.003',
    }
  }

  /**
   * Resolve method
   *
   * @param {{
   *   variables: {
   *     input: server.graphql.user.UpdateArticleInput
   *   }
   *   context: UserGraphqlContext
   * }} params
   * @returns {Promise<server.graphql.user.UpdateArticleResult>}
   */
  async resolve ({
    variables: {
      input,
    },
    context,
  }) {
    const validationError = this.validateInput({
      input,
    })

    if (validationError) {
      throw validationError
    }

    const callback = this.generateTransactionCallback({
      input,
      context,
    })

    const article = await Article.beginTransaction(callback)

    return this.formatResponse({
      article,
    })
  }

  /**
   * Create an input validator instance
   *
   * @param {{ input: server.graphql.user.UpdateArticleInput }} params
   * @returns {UpdateArticleInputValidator}
   */
  createInputValidator ({
    input,
  }) {
    return UpdateArticleInputValidator.create({
      errorHash: this.errorHash,
      input,
    })
  }

  /**
   * Validate the input
   *
   * @param {{ input: server.graphql.user.UpdateArticleInput }} params
   * @returns {import('@openreachtech/renchan').RenchanGraphqlError | null}
   */
  validateInput ({
    input,
  }) {
    return this.createInputValidator({
      input,
    })
      .validateInput()
  }

  /**
   * Generate the transaction callback
   *
   * @param {{
   *   input: server.graphql.user.UpdateArticleInput
   *   context: UserGraphqlContext
   * }} params
   * @returns {(transaction?: import('sequelize').Transaction) => Promise<model.ArticleEntity>}
   */
  generateTransactionCallback ({
    input: {
      title,
      content,
      articleId,
    },
    context: {
      now,
      userId,
    },
  }) {
    return async transaction => {
      const article = await this.findArticle({
        articleId,
        transaction,
      })

      if (!article) {
        throw this.errorHash.ArticleNotFound.create()
      }

      if (
        article.content === content
        && article.title === title
      ) {
        throw this.errorHash.CurrentArticleContentIsSameAsTheNewOne.create()
      }

      article.set({
        title,
        content,
        LastModifiedByUserId: userId,
        lastModifiedAt: now,
      })

      return /** @type {*} */ (
        article.save({
          transaction,
        })
      )
    }
  }

  /**
   * Find an article by id
   *
   * @param {{
   *   articleId: number
   *   transaction: import('sequelize').Transaction
   * }} params
   * @returns {Promise<model.ArticleEntity>}
   */
  async findArticle ({
    articleId,
    transaction,
  }) {
    return /** @type {*} */ (
      Article.findOne({
        where: {
          id: articleId,
        },
        transaction,
      })
    )
  }

  /**
   * Format the response
   *
   * @param {{ article: model.ArticleEntity }} params
   * @returns {server.graphql.user.UpdateArticleResult}
   */
  formatResponse ({
    article,
  }) {
    return {
      articleId: article.id,
    }
  }
}

/**
 * @typedef {import('../../../../contexts/UserGraphqlContext.js').default} UserGraphqlContext
 */
```

## `resolve()` — the fixed four steps

`resolve()` never grows a fifth concern. It only:

1. **validate** — `validateInput({ input })`; if it returns an error, `throw` it (fail before any
   write).
2. **build** — `generateTransactionCallback({ input, context })` returns the closure; it does not
   run yet.
3. **run** — `await <Model>.beginTransaction(callback)` executes the closure in one transaction and
   returns its result.
4. **format** — `return this.formatResponse({ ... })`.

Anything else (a post-commit side effect) is an explicit extra line **between step 3 and step 4**,
never logic hidden inside the four calls. Keep `resolve()` readable top-to-bottom.

- **`context`** carries `now` (request timestamp — use it, do not call `new Date()` yourself so all
  rows in the request share one time) and the actor (`userId` or `user`). Destructure only what the
  callback needs, and forward it into `generateTransactionCallback`.
- **Which model to call `beginTransaction` on?** Any model participating in the write works — pick
  the primary entity of the operation (create → the model being created; update/delete → the model
  being changed). The transaction spans all models regardless.

## `createInputValidator` / `validateInput`

Two thin methods, always the same:

- `createInputValidator({ input })` builds the `*InputValidator` with `{ errorHash: this.errorHash,
  input }` so the validator raises the resolver's own error codes.
- `validateInput({ input })` runs it and returns the error or `null`.

Keeping them as named methods (rather than inlining) lets tests stub the validator and keeps
`resolve()` at one altitude. Write the `*InputValidator` itself following the project's
resolver-validator conventions.

## `formatResponse`

Return the **minimum identifying result**, matching the GraphQL result type:

```js
// create / update → the id
formatResponse ({
  article,
}) {
  return {
    articleId: article.id,
  }
}

// delete → id + when it happened
formatResponse ({
  article,
}) {
  return {
    articleId: article.id,
    deletedAt: article.lastModifiedAt,
  }
}
```

Do not assemble a display object here. The mutation reports the write; the frontend re-queries for
the rendered data. A `formatResponse` that maps/sorts/joins rows is a sign business logic leaked
out of the transaction callback, or that a Query's job crept into the Mutation — pull it back. (A
resolver that skips the validator, runs no transaction, and returns a fully-built, sorted list
straight from `resolve()` is the shape to avoid.)

## Endpoint differences

Only the **context type** and the **import depth** change between endpoints (`user` / `customer` /
`admin` / `portal`). The class skeleton, method order, and flow are identical. Keep the
`@typedef` for the context pointing at the right
`server/graphql/contexts/<Endpoint>GraphqlContext.js`.
