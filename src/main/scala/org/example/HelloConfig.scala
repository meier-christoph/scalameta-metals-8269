package org.example

import metaconfig._
import metaconfig.generic._

case class HelloConfig(
    verbose: Boolean = false,
    name: String = "Susan"
)

object HelloConfig {

  lazy val default = HelloConfig()

  implicit lazy val surface: Surface[HelloConfig] =
    deriveSurface[HelloConfig]

  implicit lazy val decoder: ConfDecoder[HelloConfig] =
    deriveDecoder[HelloConfig](default)

  implicit lazy val encoder: ConfEncoder[HelloConfig] =
    deriveEncoder[HelloConfig]

}
