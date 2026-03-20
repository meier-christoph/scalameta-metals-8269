package org.example

object Main {

  def main(args: Array[String]): Unit = {
    val cfg = HelloConfig(verbose = true, name = "John Doe")
    println(HelloConfig.encoder.write(cfg).show)
  }

}
